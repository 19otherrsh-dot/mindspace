import type { NextFunction, Request, Response } from 'express';
import type { SubscriptionTier } from '@mindspace/shared';
import { isPro } from '@mindspace/shared';
import { queryOne } from '../db/pool.ts';
import { unauthorized, paywall } from '../lib/errors.ts';
import { verifyAccessToken } from '../lib/tokens.ts';

export interface AuthenticatedUser {
  id: string;
  isGuest: boolean;
  timezone: string;
  subscriptionTier: SubscriptionTier;
  trialEndsAt: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function loadUser(token: string): Promise<AuthenticatedUser> {
  const payload = verifyAccessToken(token);

  const row = await queryOne<{
    id: string;
    is_guest: boolean;
    timezone: string;
    subscription_tier: SubscriptionTier;
    trial_ends_at: Date | null;
  }>(
    `SELECT id, is_guest, timezone, subscription_tier, trial_ends_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [payload.sub],
  );

  // A valid token for a deleted account must not authenticate.
  if (!row) throw unauthorized('Account no longer exists');

  return {
    id: row.id,
    isGuest: row.is_guest,
    timezone: row.timezone,
    subscriptionTier: row.subscription_tier,
    trialEndsAt: row.trial_ends_at,
  };
}

/** Rejects the request when there is no valid bearer token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next(unauthorized());
  try {
    req.user = await loadUser(token);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches the user when a token is present but lets anonymous requests through.
 * Used by browse endpoints so the Explore tab works before sign-in while still
 * personalising (favourites, Pro state) for signed-in users.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    req.user = await loadUser(token);
  } catch {
    // A stale token on a public endpoint is treated as anonymous, not an error.
  }
  next();
}

/** True when the user's paid tier — or an active free trial — grants Pro access. */
export function hasProAccess(user: AuthenticatedUser | undefined): boolean {
  if (!user) return false;
  if (isPro(user.subscriptionTier)) return true;
  return user.trialEndsAt !== null && user.trialEndsAt.getTime() > Date.now();
}

/** Guards Pro-only routes; the 402 tells the client to open the paywall. */
export function requirePro(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (!hasProAccess(req.user)) return next(paywall());
  next();
}
