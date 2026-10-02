import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { AuthResponse } from '@mindspace/shared';
import { transaction } from '../db/pool.ts';
import { badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { isValidTimezone } from '../lib/dates.ts';
import { issueTokens, revokeAllForUser, revokeToken, rotateTokens } from '../lib/tokens.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { findByEmail, getUserById } from '../services/users.ts';
import { redis } from '../redis.ts';
import { localDate } from '../lib/dates.ts';
import { posthog } from '../lib/telemetry.ts';

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long');

const timezoneSchema = z
  .string()
  .default('UTC')
  .refine(isValidTimezone, 'Unrecognised timezone');

const signUpSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
  timezone: timezoneSchema,
});

const logInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  timezone: timezoneSchema.optional(),
});

/** Signup and login share a limiter so credential stuffing hits both paths. */
const authLimiter = rateLimit({ limit: 10, windowSeconds: 300, bucket: 'auth' });

/** Creates the user row plus its preferences row as one unit. */
export async function createUser(input: {
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  isGuest: boolean;
  timezone: string;
  authProvider?: 'password' | 'apple' | 'google';
  providerSubject?: string | null;
}): Promise<string> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users
         (email, password_hash, display_name, is_guest, timezone, auth_provider, provider_subject)
       VALUES ($1, $2, $3, $4, $5, $6::auth_provider, $7)
       RETURNING id`,
      [
        input.email,
        input.passwordHash,
        input.displayName,
        input.isGuest,
        input.timezone,
        input.authProvider ?? 'password',
        input.providerSubject ?? null,
      ],
    );

    const userId = rows[0]!.id;
    // Every user must have preferences; the USER_SELECT join is not outer.
    await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [userId]);
    return userId;
  });
}

export async function respondWithAuth(userId: string, isGuest: boolean): Promise<AuthResponse> {
  const [user, tokens] = await Promise.all([getUserById(userId), issueTokens(userId, isGuest)]);
  if (!user) throw unauthorized('Account could not be loaded');
  return { user, tokens };
}

/** POST /auth/signup — email + password account (screen 3). */
authRouter.post('/signup', authLimiter, async (req, res) => {
  const input = signUpSchema.parse(req.body);
  const email = input.email.toLowerCase();

  if (await findByEmail(email)) {
    throw conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const displayName = input.displayName ?? email.split('@')[0]!;

  const userId = await createUser({
    email,
    passwordHash,
    displayName,
    isGuest: false,
    timezone: input.timezone,
  });

  if (posthog) {
    posthog.capture({
      distinctId: userId,
      event: 'User Signed Up',
      properties: { method: 'email' }
    });
  }

  res.status(201).json(await respondWithAuth(userId, false));
});

/** POST /auth/login */
authRouter.post('/login', authLimiter, async (req, res) => {
  const input = logInSchema.parse(req.body);
  const account = await findByEmail(input.email.toLowerCase());

  // Hash against a dummy value when the account is missing so the response
  // time does not reveal which emails are registered.
  const hash = account?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(input.password, hash);

  if (!account || !ok) throw unauthorized('Incorrect email or password');

  if (posthog) {
    posthog.capture({
      distinctId: account.id,
      event: 'User Logged In',
      properties: { method: 'email', isGuest: account.isGuest }
    });
  }

  res.json(await respondWithAuth(account.id, account.isGuest));
});

/** POST /auth/guest — the "Try for free" path on screen 3. */
authRouter.post('/guest', async (req, res) => {
  const { timezone } = z.object({ timezone: timezoneSchema }).parse(req.body ?? {});

  const userId = await createUser({
    email: null,
    passwordHash: null,
    displayName: 'Friend',
    isGuest: true,
    timezone,
  });

  if (posthog) {
    posthog.capture({
      distinctId: userId,
      event: 'Guest Session Started'
    });
  }

  res.status(201).json(await respondWithAuth(userId, true));
});

/**
 * POST /auth/convert — turns the signed-in guest into a full account in place,
 * so the streak and history built during the trial survive signup.
 */
authRouter.post('/convert', requireAuth, async (req, res) => {
  const user = req.user!;
  if (!user.isGuest) throw badRequest('This account is already registered');

  const input = signUpSchema.omit({ timezone: true }).parse(req.body);
  const email = input.email.toLowerCase();

  if (await findByEmail(email)) {
    throw conflict('An account with that email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  await transaction(async (client) => {
    await client.query(
      `UPDATE users
          SET email = $2, password_hash = $3, display_name = $4, is_guest = FALSE
        WHERE id = $1::uuid`,
      [user.id, email, passwordHash, input.displayName ?? email.split('@')[0]!],
    );
  });

  if (posthog) {
    posthog.capture({
      distinctId: user.id,
      event: 'Guest Converted to Account'
    });
  }

  // The old tokens carry guest: true, so replace the whole family.
  await revokeAllForUser(user.id);
  res.json(await respondWithAuth(user.id, false));
});

/** POST /auth/refresh — rotates the refresh token and mints a new access token. */
authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = z
    .object({ refreshToken: z.string().min(1) })
    .parse(req.body);

  const { userId, tokens } = await rotateTokens(refreshToken);
  const user = await getUserById(userId);
  if (!user) throw unauthorized('Account no longer exists');

  res.json({ user, tokens } satisfies AuthResponse);
});

/** POST /auth/logout — revokes just the presented refresh token. */
authRouter.post('/logout', async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(1).optional() }).parse(req.body ?? {});
  if (parsed.refreshToken) await revokeToken(parsed.refreshToken);
  res.status(204).end();
});

/** POST /auth/logout-all — signs the user out on every device. */
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllForUser(req.user!.id);
  res.status(204).end();
});
