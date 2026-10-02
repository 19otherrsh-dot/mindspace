import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.ts';
import { notFound } from '../lib/errors.ts';
import { isValidTimezone } from '../lib/dates.ts';
import { requireAuth } from '../middleware/auth.ts';
import { revokeAllForUser } from '../lib/tokens.ts';
import { getUserById } from '../services/users.ts';
import { cacheDelete } from '../redis.ts';

export const usersRouter = Router();

/** GET /users/me */
usersRouter.get('/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.user!.id);
  if (!user) throw notFound('User');
  res.json(user);
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  timezone: z.string().refine(isValidTimezone, 'Unrecognised timezone').optional(),
});

/** PATCH /users/me */
usersRouter.patch('/me', requireAuth, async (req, res) => {
  const input = profileSchema.parse(req.body);

  const sets: string[] = [];
  const values: unknown[] = [req.user!.id];
  let i = 2;

  if (input.displayName !== undefined) {
    sets.push(`display_name = $${i++}`);
    values.push(input.displayName);
  }
  if (input.avatarUrl !== undefined) {
    sets.push(`avatar_url = $${i++}`);
    values.push(input.avatarUrl);
  }
  if (input.timezone !== undefined) {
    sets.push(`timezone = $${i++}`);
    values.push(input.timezone);
  }

  if (sets.length > 0) {
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1::uuid`, values);
    // The feed embeds the display name and is keyed on the user's timezone.
    await cacheDelete(`feed:${req.user!.id}`);
  }

  res.json(await getUserById(req.user!.id));
});

const preferencesSchema = z.object({
  reminderEnabled: z.boolean().optional(),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM')
    .optional(),
  reminderDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  reminderMessage: z.string().trim().min(1).max(140).optional(),
  bedtimeEnabled: z.boolean().optional(),
  bedtimeTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM')
    .optional(),
  backgroundSoundEnabled: z.boolean().optional(),
  audioQuality: z.enum(['standard', 'high']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  preferredVoicePack: z.enum(['calm', 'warm', 'neutral']).optional(),
  downloadOverCellular: z.boolean().optional(),
});

/** PATCH /users/me/preferences — the Settings panel (screen 16). */
usersRouter.patch('/me/preferences', requireAuth, async (req, res) => {
  const input = preferencesSchema.parse(req.body);

  const columns: Record<keyof typeof input, string> = {
    reminderEnabled: 'reminder_enabled',
    reminderTime: 'reminder_time',
    reminderDays: 'reminder_days',
    reminderMessage: 'reminder_message',
    bedtimeEnabled: 'bedtime_enabled',
    bedtimeTime: 'bedtime_time',
    backgroundSoundEnabled: 'background_sound_enabled',
    audioQuality: 'audio_quality',
    theme: 'theme',
    preferredVoicePack: 'preferred_voice_pack',
    downloadOverCellular: 'download_over_cellular',
  };

  const sets: string[] = [];
  const values: unknown[] = [req.user!.id];
  let i = 2;

  for (const [key, column] of Object.entries(columns)) {
    const value = input[key as keyof typeof input];
    if (value === undefined) continue;
    // Enum columns need an explicit cast when bound as text.
    const cast =
      column === 'audio_quality'
        ? '::audio_quality'
        : column === 'theme'
          ? '::theme_preference'
          : column === 'preferred_voice_pack'
            ? '::voice_pack'
            : column === 'reminder_days'
              ? '::smallint[]'
              : '';
    sets.push(`${column} = $${i++}${cast}`);
    values.push(value);
  }

  if (sets.length > 0) {
    await query(`UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = $1::uuid`, values);
  }

  res.json((await getUserById(req.user!.id))?.preferences);
});

const onboardingSchema = z.object({
  goals: z
    .array(z.enum(['stress', 'anxiety', 'sleep', 'focus', 'relationships', 'sports', 'beginners']))
    .min(1)
    .max(7),
  experienceLevel: z.enum(['new', 'some', 'experienced']),
  sleepQuality: z.enum(['poor', 'fair', 'good']),
  dailyMinutes: z.number().int().min(1).max(120),
  preferredTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'flexible']).default('flexible'),
});

/**
 * When each answer to "When suits you best?" schedules the reminder.
 *
 * Asking someone to commit to a time and then not using the answer wastes the
 * strongest habit lever in onboarding — a concrete plan is what turns intent
 * into a return visit. 'flexible' keeps the existing default rather than
 * guessing at a time the user declined to pick.
 */
const REMINDER_TIME_FOR: Record<string, string | null> = {
  morning: '08:00',
  afternoon: '13:00',
  evening: '20:00',
  flexible: null,
};

/** PUT /users/me/onboarding — results of the quiz (screen 4). */
usersRouter.put('/me/onboarding', requireAuth, async (req, res) => {
  const input = onboardingSchema.parse(req.body);

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO onboarding_profiles
         (user_id, goals, experience_level, sleep_quality, daily_minutes, preferred_time)
       VALUES ($1::uuid, $2::content_category[], $3::experience_level, $4::sleep_quality, $5, $6::time_of_day)
       ON CONFLICT (user_id) DO UPDATE SET
         goals = EXCLUDED.goals,
         experience_level = EXCLUDED.experience_level,
         sleep_quality = EXCLUDED.sleep_quality,
         daily_minutes = EXCLUDED.daily_minutes,
         preferred_time = EXCLUDED.preferred_time,
         completed_at = now()`,
      [
        req.user!.id,
        input.goals,
        input.experienceLevel,
        input.sleepQuality,
        input.dailyMinutes,
        input.preferredTimeOfDay,
      ],
    );

    /*
     * Act on the answer. Without this the reminder sits at the column default
     * of 08:00 for everyone, so a user who chose "Evening" is nudged at eight
     * in the morning — the one moment they told us not to.
     *
     * Only the untouched default is overwritten: someone who has already set a
     * time in Settings has expressed a stronger preference than a quiz tap,
     * and re-running the quiz must not stamp on it.
     */
    const reminderTime = REMINDER_TIME_FOR[input.preferredTimeOfDay];
    if (reminderTime) {
      await client.query(
        `UPDATE user_preferences
            SET reminder_time = $2::time
          WHERE user_id = $1::uuid AND reminder_time = '08:00'::time`,
        [req.user!.id, reminderTime],
      );
    }
  });

  // The quiz answers drive the daily recommendation, so drop the cached feed.
  await cacheDelete(`feed:${req.user!.id}`);
  res.json(await getUserById(req.user!.id));
});

/**
 * DELETE /users/me — GDPR / CCPA erasure (PRD §5.2). Soft-deletes immediately
 * and scrubs the identifying columns, so the account is unreachable at once
 * while the nightly purge job removes the rows for good.
 */
usersRouter.delete('/me', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  await transaction(async (client) => {
    await client.query(
      `UPDATE users
          SET deleted_at = now(),
              email = NULL,
              password_hash = NULL,
              display_name = 'Deleted user',
              avatar_url = NULL
        WHERE id = $1::uuid`,
      [userId],
    );
    // Health data goes straight away rather than waiting for the purge.
    await client.query('DELETE FROM mood_entries WHERE user_id = $1::uuid', [userId]);
  });

  await revokeAllForUser(userId);
  await cacheDelete(`feed:${userId}`);
  res.status(204).end();
});
