import { Router } from 'express';
import { z } from 'zod';
import {
  FIRST_TEN_DAYS,
  type CompleteSessionResponse,
  type MoodEntry,
  type MoodValue,
  type SleepEntry,
  type SleepValue,
} from '@mindspace/shared';
import { query, transaction } from '../db/pool.ts';
import { badRequest, notFound, paywall } from '../lib/errors.ts';
import { encryptNote, decryptNote } from '../lib/crypto.ts';
import { addDays, localDate } from '../lib/dates.ts';
import { hasProAccess, requireAuth } from '../middleware/auth.ts';
import { getSessionById } from '../services/content.ts';
import { recordCourseDay } from '../services/courses.ts';
import { awardAchievements, getAchievementProgress } from '../services/stats.ts';
import { applyStreakProtection } from '../services/streak.ts';
import { cacheDelete } from '../redis.ts';

export const activityRouter = Router();

const completeSchema = z.object({
  sessionId: z.string().uuid(),
  startedAt: z.string().datetime(),
  secondsListened: z.number().int().min(0).max(60 * 60 * 4),
  finished: z.boolean().default(true),
  courseId: z.string().uuid().optional(),
  courseDayNumber: z.number().int().min(1).optional(),
});

/**
 * POST /activity/complete — called when the player finishes or the user ends a
 * session early. Drives the post-session summary (screen 11): streak, weekly
 * minutes, freshly unlocked badges and course progression.
 */
activityRouter.post('/complete', requireAuth, async (req, res) => {
  const input = completeSchema.parse(req.body);
  const user = req.user!;

  const session = await getSessionById(input.sessionId, user.id);
  if (!session) throw notFound('Session');

  // Re-check entitlement at write time so a client cannot bank minutes for
  // Pro content it was never allowed to stream.
  if (session.isPro && !hasProAccess(user)) throw paywall();

  if ((input.courseId === undefined) !== (input.courseDayNumber === undefined)) {
    throw badRequest('courseId and courseDayNumber must be sent together');
  }

  // Cap at the session's real length so a bad client cannot inflate totals.
  const secondsListened = Math.min(input.secondsListened, session.durationSeconds);
  const activityDate = localDate(user.timezone);

  const completion = await transaction(async (client) => {
    const { rows } = await client.query<{ id: string; completed_at: Date }>(
      `INSERT INTO session_completions
         (user_id, session_id, started_at, seconds_listened, finished,
          course_id, course_day_number, activity_date)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::date)
       RETURNING id, completed_at`,
      [
        user.id,
        input.sessionId,
        input.startedAt,
        secondsListened,
        input.finished,
        input.courseId ?? null,
        input.courseDayNumber ?? null,
        activityDate,
      ],
    );

    await client.query('UPDATE sessions SET play_count = play_count + 1 WHERE id = $1::uuid', [
      input.sessionId,
    ]);

    return rows[0]!;
  });

  // Only a session played to the end advances a course.
  let courseCompleted = false;
  let certificateUrl: string | null = null;
  if (input.courseId && input.courseDayNumber && input.finished) {
    const progress = await recordCourseDay(user.id, input.courseId, input.courseDayNumber);
    if (progress) {
      courseCompleted = progress.courseCompleted;
      certificateUrl = progress.certificateUrl;
    }
  }

  // The streak only ticks up on the day's *first* session, so the summary
  // screen celebrates once rather than after every replay.
  const earlierToday = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM session_completions
        WHERE user_id = $1::uuid AND activity_date = $2::date AND id <> $3::uuid
     ) AS exists`,
    [user.id, activityDate, completion.id],
  );
  const streakIncreased = !(earlierToday.rows[0]?.exists ?? false);

  /*
   * Repair the streak *before* reading progress, so a user returning after one
   * missed day sees the continued run — and their achievement thresholds are
   * measured against it — rather than a reset. Idempotent, so a replayed
   * completion cannot spend the allowance twice.
   */
  const protection = await applyStreakProtection(user.id, user.timezone);

  const progress = await getAchievementProgress(user.id, user.timezone);
  const newAchievements = await awardAchievements(user.id, progress);

  /*
   * Distinct days practised, so the tenth can be celebrated as it happens.
   * Counting stops at the milestone: past it the number is never shown again,
   * and an unbounded count over a long history would be wasted work.
   */
  const practised = await query<{ days: number }>(
    `SELECT count(*)::int AS days
       FROM (
         SELECT DISTINCT activity_date
           FROM session_completions
          WHERE user_id = $1::uuid
          LIMIT $2
       ) AS d`,
    [user.id, FIRST_TEN_DAYS],
  );
  const practiceDays = practised.rows[0]?.days ?? 0;

  // Only on the day's first session, so replaying does not re-celebrate.
  const reachedFirstTenDays = practiceDays === FIRST_TEN_DAYS && streakIncreased;

  const weekStart = addDays(activityDate, -6);
  const weekly = await query<{ minutes: number }>(
    `SELECT coalesce(round(sum(seconds_listened) / 60.0), 0)::int AS minutes
       FROM session_completions
      WHERE user_id = $1::uuid AND activity_date BETWEEN $2::date AND $3::date`,
    [user.id, weekStart, activityDate],
  );

  // The home feed embeds the streak and "continue" row, both now stale.
  await cacheDelete(`feed:${user.id}`);

  const body: CompleteSessionResponse = {
    completion: {
      id: completion.id,
      sessionId: session.id,
      session,
      startedAt: input.startedAt,
      completedAt: completion.completed_at.toISOString(),
      secondsListened,
      finished: input.finished,
      courseId: input.courseId ?? null,
      courseDayNumber: input.courseDayNumber ?? null,
    },
    streak: progress.streak,
    streakIncreased,
    minutesThisWeek: weekly.rows[0]?.minutes ?? 0,
    totalMinutes: progress.totalMinutes,
    newAchievements,
    courseCompleted,
    certificateUrl,
    streakProtectedDate: protection.protectedDate,
    restDaysRemaining: protection.remaining,
    practiceDays,
    reachedFirstTenDays,
  };

  res.status(201).json(body);
});

/** GET /activity/history — the Activity tab on the profile (screen 15). */
activityRouter.get('/history', requireAuth, async (req, res) => {
  const { limit, offset } = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);

  const { rows } = await query<{
    id: string;
    session_id: string;
    title: string;
    artwork_url: string;
    duration_seconds: number;
    started_at: Date;
    completed_at: Date;
    seconds_listened: number;
    finished: boolean;
    course_id: string | null;
    course_day_number: number | null;
  }>(
    `SELECT sc.id, sc.session_id, s.title, s.artwork_url, s.duration_seconds,
            sc.started_at, sc.completed_at, sc.seconds_listened, sc.finished,
            sc.course_id, sc.course_day_number
       FROM session_completions sc
       JOIN sessions s ON s.id = sc.session_id
      WHERE sc.user_id = $1::uuid
      ORDER BY sc.completed_at DESC
      LIMIT $2 OFFSET $3`,
    [req.user!.id, limit, offset],
  );

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      title: r.title,
      artworkUrl: r.artwork_url,
      durationSeconds: r.duration_seconds,
      startedAt: r.started_at.toISOString(),
      completedAt: r.completed_at.toISOString(),
      secondsListened: r.seconds_listened,
      finished: r.finished,
      courseId: r.course_id,
      courseDayNumber: r.course_day_number,
    })),
  });
});

/* ------------------------------------------------------------------ */
/* Mood check-ins                                                      */
/* ------------------------------------------------------------------ */

const moodSchema = z.object({
  value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  context: z.enum(['pre_session', 'post_session', 'standalone']).default('standalone'),
  note: z.string().trim().max(1000).optional(),
  sessionId: z.string().uuid().optional(),
});

/** POST /activity/mood — screens 6 and 11. */
activityRouter.post('/mood', requireAuth, async (req, res) => {
  const input = moodSchema.parse(req.body);
  const user = req.user!;

  const { rows } = await query<{ id: string; recorded_at: Date }>(
    `INSERT INTO mood_entries (user_id, value, context, note_encrypted, session_id, activity_date)
     VALUES ($1::uuid, $2, $3::mood_context, $4, $5::uuid, $6::date)
     RETURNING id, recorded_at`,
    [
      user.id,
      input.value,
      input.context,
      encryptNote(input.note),
      input.sessionId ?? null,
      localDate(user.timezone),
    ],
  );

  await cacheDelete(`feed:${user.id}`);

  const entry: MoodEntry = {
    id: rows[0]!.id,
    value: input.value as MoodValue,
    context: input.context,
    note: input.note ?? null,
    sessionId: input.sessionId ?? null,
    recordedAt: rows[0]!.recorded_at.toISOString(),
  };
  res.status(201).json(entry);
});

/** GET /activity/mood — recent check-ins for the mini trend chart on screen 6. */
activityRouter.get('/mood', requireAuth, async (req, res) => {
  const { days } = z
    .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
    .parse(req.query);

  const from = addDays(localDate(req.user!.timezone), -(days - 1));

  const { rows } = await query<{
    id: string;
    value: MoodValue;
    context: 'pre_session' | 'post_session' | 'standalone';
    note_encrypted: Buffer | null;
    session_id: string | null;
    recorded_at: Date;
  }>(
    `SELECT id, value, context, note_encrypted, session_id, recorded_at
       FROM mood_entries
      WHERE user_id = $1::uuid AND activity_date >= $2::date
      ORDER BY recorded_at DESC`,
    [req.user!.id, from],
  );

  const items: MoodEntry[] = rows.map((r) => ({
    id: r.id,
    value: r.value,
    context: r.context,
    note: decryptNote(r.note_encrypted),
    sessionId: r.session_id,
    recordedAt: r.recorded_at.toISOString(),
  }));

  res.json({ items });
});

/* ------------------------------------------------------------------ */
/* Sleep check-ins                                                     */
/* ------------------------------------------------------------------ */

/**
 * Sleep is asked about once during onboarding and then never measured, so
 * neither the user nor we can tell whether the sleepcasts are doing anything.
 * A nightly reading makes that answerable — and gives the sleep content a
 * reason to be opened beyond the evening feed row.
 */

const sleepSchema = z.object({
  quality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  note: z.string().trim().max(1000).optional(),
  /**
   * The night being reported on. Defaults to last night, because a sleep
   * check-in is something you do in the morning about the night before.
   */
  nightDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** PUT /activity/sleep — one reading per night; a resubmission corrects it. */
activityRouter.put('/sleep', requireAuth, async (req, res) => {
  const input = sleepSchema.parse(req.body);
  const user = req.user!;

  const nightDate = input.nightDate ?? addDays(localDate(user.timezone), -1);

  const { rows } = await query<{ id: string; recorded_at: Date }>(
    `INSERT INTO sleep_entries (user_id, night_date, quality, note_ciphertext)
     VALUES ($1::uuid, $2::date, $3, $4)
     ON CONFLICT (user_id, night_date) DO UPDATE
       SET quality = EXCLUDED.quality,
           note_ciphertext = EXCLUDED.note_ciphertext,
           recorded_at = now()
     RETURNING id, recorded_at`,
    [user.id, nightDate, input.quality, encryptNote(input.note)],
  );

  const entry: SleepEntry = {
    id: rows[0]!.id,
    nightDate,
    quality: input.quality as SleepValue,
    note: input.note ?? null,
    recordedAt: rows[0]!.recorded_at.toISOString(),
  };
  res.status(201).json(entry);
});

/** GET /activity/sleep — the nightly trend, to chart against mood. */
activityRouter.get('/sleep', requireAuth, async (req, res) => {
  const { days } = z
    .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
    .parse(req.query);

  const from = addDays(localDate(req.user!.timezone), -(days - 1));

  const { rows } = await query<{
    id: string;
    night_date: string;
    quality: SleepValue;
    note_ciphertext: Buffer | null;
    recorded_at: Date;
  }>(
    `SELECT id, to_char(night_date, 'YYYY-MM-DD') AS night_date,
            quality, note_ciphertext, recorded_at
       FROM sleep_entries
      WHERE user_id = $1::uuid AND night_date >= $2::date
      ORDER BY night_date DESC`,
    [req.user!.id, from],
  );

  const items: SleepEntry[] = rows.map((r) => ({
    id: r.id,
    nightDate: r.night_date,
    quality: r.quality,
    note: decryptNote(r.note_ciphertext),
    recordedAt: r.recorded_at.toISOString(),
  }));

  res.json({ items });
});
