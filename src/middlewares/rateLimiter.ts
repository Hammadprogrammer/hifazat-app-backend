import { Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import redis from '../config/redis';
import { AuthenticatedRequest } from './auth.middleware';

/**
 * SOS rate limiter — max 5 SOS triggers per user per hour.
 * Backed by Upstash Redis sliding window; fails open if Redis is unreachable
 * (an emergency alert should never be blocked by infra issues).
 */
const sosRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  prefix: 'ratelimit:sos',
});

export async function sosRateLimiter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
  } catch (err) {
    // Fail open — never block an emergency because Redis is down
    console.error('[rateLimiter] Redis unavailable, failing open:', err);
    next();
  }
}
