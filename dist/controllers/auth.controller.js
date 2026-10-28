"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../config/db"));
const phone_1 = require("../lib/phone");
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '7d';
function signToken(userId) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not configured');
    }
    return jsonwebtoken_1.default.sign({ userId }, secret, { expiresIn: TOKEN_EXPIRY });
}
/** POST /api/auth/signup */
async function signup(req, res) {
    try {
        const { name, phone, city, email, password } = req.body;
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
        const normalized = (0, phone_1.normalizePhone)(phone);
        if (!(0, phone_1.isValidE164)(normalized)) {
            res.status(400).json({ success: false, message: 'Enter a valid phone number, e.g. +92 300 1234567' });
            return;
        }
        const existing = await db_1.default.user.findUnique({ where: { phone: normalized } });
        if (existing) {
            res.status(409).json({ success: false, message: 'An account with this phone already exists' });
            return;
        }
        const hashed = await bcryptjs_1.default.hash(password, SALT_ROUNDS);
        const user = await db_1.default.user.create({
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
    }
    catch (err) {
        console.error('[auth.signup]', err);
        res.status(500).json({ success: false, message: 'Failed to create account' });
    }
}
/** POST /api/auth/login — verify phone + password and return the JWT + user */
async function login(req, res) {
    try {
        const { phone, password } = req.body;
        if (!phone?.trim() || !password) {
            res.status(400).json({ success: false, message: 'phone and password are required' });
            return;
        }
        const user = await db_1.default.user.findUnique({ where: { phone: (0, phone_1.normalizePhone)(phone) } });
        if (!user || !(await bcryptjs_1.default.compare(password, user.password))) {
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
    }
    catch (err) {
        console.error('[auth.login]', err);
        res.status(500).json({ success: false, message: 'Failed to log in' });
    }
}
