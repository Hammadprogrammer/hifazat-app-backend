"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function authenticate(req, res, next) {
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
        const payload = jsonwebtoken_1.default.verify(token, secret);
        req.userId = payload.userId;
        next();
    }
    catch {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
}
