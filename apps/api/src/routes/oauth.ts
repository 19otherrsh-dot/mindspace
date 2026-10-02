import { Router } from 'express';
import { z } from 'zod';
import { conflict } from '../lib/errors.ts';
import { isValidTimezone } from '../lib/dates.ts';
import { query, queryOne } from '../db/pool.ts';
import { findByEmail } from '../services/users.ts';
import { verifyAppleToken, verifyGoogleToken } from '../services/social-auth.ts';
import { createUser, respondWithAuth } from './auth.ts';

export const oauthRouter = Router();

/**
 * Sign in with Apple / Google.
 *
 * The identity token is verified against the provider's JWKS before any claim
 * in it is trusted — decoding the payload and reading the email is not
 * authentication, it is accepting whatever the caller typed. See
 * `services/social-auth.ts` for signature, issuer, audience and nonce checks.
 */

const timezoneSchema = z
  .string()
  .default('UTC')
  .refine(isValidTimezone, 'Unrecognised timezone');

const baseSchema = z.object({
  timezone: timezoneSchema,
  /** Raw nonce the client generated; guards against a replayed token. */
  nonce: z.string().min(8).max(200).optional(),
});

const appleSchema = baseSchema.extend({
  identityToken: z.string().min(1),
  // Apple sends the name exactly once, on first authorisation.
  fullName: z
    .object({
      givenName: z.string().trim().max(60).optional(),
      familyName: z.string().trim().max(60).optional(),
    })
    .optional(),
});

const googleSchema = baseSchema.extend({
  idToken: z.string().min(1),
});

/**
 * Finds or creates the account behind a verified provider identity.
 *
 * The join key is the provider's `sub`, never the email. Apple's private-relay
 * addresses can change, and matching on email would let anyone able to obtain
 * a provider token for an address take over the existing password account
 * using it.
 */
async function upsertSocialUser(input: {
  provider: 'apple' | 'google';
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  timezone: string;
}): Promise<{ userId: string; created: boolean }> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM users
      WHERE auth_provider = $1::auth_provider AND provider_subject = $2 AND deleted_at IS NULL`,
    [input.provider, input.subject],
  );

  if (existing) {
    // Keep the address current if the user de-anonymised or changed it. A
    // collision means it belongs to someone else; their login still works.
    if (input.email && input.emailVerified) {
      await query(
        'UPDATE users SET email = $2 WHERE id = $1::uuid AND email IS DISTINCT FROM $2',
        [existing.id, input.email],
      ).catch(() => {});
    }
    return { userId: existing.id, created: false };
  }

  /*
   * An existing account with this email is *not* silently adopted. Linking a
   * provider to an account is a decision its owner should make while already
   * authenticated — doing it here would mean a provider token is enough to
   * reach an account protected by a password.
   */
  if (input.email) {
    const clash = await findByEmail(input.email);
    if (clash) {
      throw conflict(
        'An account already exists with that email. Sign in with your password, ' +
          'then link this provider from Settings.',
      );
    }
  }

  const userId = await createUser({
    // Only a provider-verified address is worth recording.
    email: input.emailVerified ? input.email : null,
    passwordHash: null,
    displayName: input.displayName,
    isGuest: false,
    timezone: input.timezone,
    authProvider: input.provider,
    providerSubject: input.subject,
  });

  return { userId, created: true };
}

/** POST /auth/apple */
oauthRouter.post('/apple', async (req, res) => {
  const input = appleSchema.parse(req.body);
  const identity = await verifyAppleToken(input.identityToken, input.nonce);

  const name = [input.fullName?.givenName, input.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();

  const { userId, created } = await upsertSocialUser({
    provider: 'apple',
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    displayName: name || identity.email?.split('@')[0] || 'Friend',
    timezone: input.timezone,
  });

  res.status(created ? 201 : 200).json(await respondWithAuth(userId, false));
});

/** POST /auth/google */
oauthRouter.post('/google', async (req, res) => {
  const input = googleSchema.parse(req.body);
  const identity = await verifyGoogleToken(input.idToken, input.nonce);

  const { userId, created } = await upsertSocialUser({
    provider: 'google',
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    displayName: identity.name || identity.email?.split('@')[0] || 'Friend',
    timezone: input.timezone,
  });

  res.status(created ? 201 : 200).json(await respondWithAuth(userId, false));
});
