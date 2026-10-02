import type { NextFunction, Request, Response } from 'express';
import { incrementWindow } from '../redis.ts';
import { tooManyRequests } from '../lib/errors.ts';

/**
 * Fixed-window limiter keyed by IP (and user id when signed in). Backed by
 * Redis; when Redis is unavailable it fails open rather than locking everyone
 * out of the app.
 */
export function rateLimit(options: { limit: number; windowSeconds: number; bucket: string }) {
  return async function limiter(req: Request, _res: Response, next: NextFunction) {
    const identity = req.user?.id ?? req.ip ?? 'unknown';
    const key = `ratelimit:${options.bucket}:${identity}`;

    const count = await incrementWindow(key, options.windowSeconds);
    if (count > options.limit) {
      return next(tooManyRequests());
    }
    next();
  };
}
