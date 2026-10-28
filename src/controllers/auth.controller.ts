import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { isValidE164, normalizePhone } from '../lib/phone';

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '7d';

function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign({ userId }, secret, { expiresIn: TOKEN_EXPIRY });
}

/** POST /api/auth/signup */
export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { name, phone, city, email, password } = req.body as {
      name?: string;
      phone?: string;
      city?: string;
      email?: string;
      password?: string;
    };

    if (!name?.trim() || !phone?.trim() || !city?.trim() || !password) {
      res
        .status(400)
        .json({ success: false, message: 'name, phone, city and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      return;
    }

    const normalized = normalizePhone(phone);
    if (!isValidE164(normalized)) {
      res.status(400).json({ success: false, message: 'Enter a valid phone number, e.g. +92 300 1234567' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { phone: normalized } });
    if (existing) {
      res.status(409).json({ success: false, message: 'An account with this phone already exists' });
      return;
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: normalized,
        city: city.trim(),
        email: email?.trim() || null,
        password: hashed,
      },
      select: { id: true, name: true, phone: true, city: true, email: true, createdAt: true },
    });

    // No token here — user must log in after signup.
    res.status(201).json({
      success: true,
      message: 'Account created successfully. Please log in.',
      data: { user },
    });
  } catch (err) {
    console.error('[auth.signup]', err);
    res.status(500).json({ success: false, message: 'Failed to create account' });
  }
}

/** POST /api/auth/login — verify phone + password and return the JWT + user */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { phone, password } = req.body as { phone?: string; password?: string };

    if (!phone?.trim() || !password) {
      res.status(400).json({ success: false, message: 'phone and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ success: false, message: 'Invalid phone or password' });
      return;
    }

    const token = signToken(user.id);

    res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, phone: user.phone, city: user.city, email: user.email },
        token,
      },
    });
  } catch (err) {
    console.error('[auth.login]', err);
    res.status(500).json({ success: false, message: 'Failed to log in' });
  }
}
