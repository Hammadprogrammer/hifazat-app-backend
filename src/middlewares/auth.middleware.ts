import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authorization token required' });
    return;
  }

  const token = header.slice('Bearer '.length);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ success: false, message: 'Server misconfiguration: JWT_SECRET missing' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
