import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { AuthTokens } from '@mindspace/shared';
import { config } from '../config.ts';
import { query } from '../db/pool.ts';
import { hashToken } from './crypto.ts';
import { unauthorized } from './errors.ts';

export interface AccessTokenPayload {
  sub: string;
  guest: boolean;
}

export function signAccessToken(userId: string, isGuest: boolean): string {
  return jwt.sign({ sub: userId, guest: isGuest }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
    issuer: 'mindspace',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, { issuer: 'mindspace' });
    if (typeof decoded === 'string' || !decoded.sub) throw new Error('malformed');
    return { sub: decoded.sub, guest: Boolean((decoded as { guest?: boolean }).guest) };
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw unauthorized(expired ? 'Access token expired' : 'Invalid access token');
  }
}

/**
 * Refresh tokens are opaque random strings rather than JWTs so they can be
 * revoked server-side (log out, delete account, password change).
 */
export async function issueTokens(userId: string, isGuest: boolean): Promise<AuthTokens> {
  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtl * 1000);

  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(refreshToken), expiresAt],
  );

  return {
    accessToken: signAccessToken(userId, isGuest),
    refreshToken,
    expiresIn: config.jwt.accessTtl,
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating the old one. Reuse of an
 * already-rotated token revokes the whole family — the standard defence against
 * a stolen refresh token being replayed.
 */
export async function rotateTokens(refreshToken: string): Promise<{ userId: string; tokens: AuthTokens }> {
  const tokenHash = hashToken(refreshToken);

  const { rows } = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    is_guest: boolean;
  }>(
    `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.is_guest
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1 AND u.deleted_at IS NULL`,
    [tokenHash],
  );

  const record = rows[0];
  if (!record) throw unauthorized('Invalid refresh token');

  if (record.revoked_at) {
    await revokeAllForUser(record.user_id);
    throw unauthorized('Refresh token has already been used — please sign in again');
  }

  if (record.expires_at.getTime() < Date.now()) {
    throw unauthorized('Refresh token expired');
  }

  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [record.id]);
  const tokens = await issueTokens(record.user_id, record.is_guest);
  return { userId: record.user_id, tokens };
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(refreshToken)],
  );
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}
