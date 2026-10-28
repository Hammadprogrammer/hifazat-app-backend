"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sosRateLimiter = sosRateLimiter;
const ratelimit_1 = require("@upstash/ratelimit");
const redis_1 = __importDefault(require("../config/redis"));
/**
 * SOS rate limiter — max 5 SOS triggers per user per hour.
 * Backed by Upstash Redis sliding window; fails open if Redis is unreachable
 * (an emergency alert should never be blocked by infra issues).
 */
const sosRatelimit = new ratelimit_1.Ratelimit({
    redis: redis_1.default,
    limiter: ratelimit_1.Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'ratelimit:sos',
});
async function sosRateLimiter(req, res, next) {
    const identifier = req.userId ?? req.ip ?? 'anonymous';
    try {
        const { success, remaining, reset } = await sosRatelimit.limit(identifier);
        res.setHeader('X-RateLimit-Remaining', String(remaining));
        res.setHeader('X-RateLimit-Reset', String(reset));
        if (!success) {
            const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
            res.setHeader('Retry-After', String(retryAfterSec));
            res.status(429).json({
                success: false,
                message: 'SOS limit reached (5 per hour). Please try again later.',
                retryAfterSeconds: retryAfterSec,
            });
            return;
        }
        next();
    }
    catch (err) {
        // Fail open — never block an emergency because Redis is down
        console.error('[rateLimiter] Redis unavailable, failing open:', err);
        next();
    }
}
