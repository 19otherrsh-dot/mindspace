import type {
  Achievement,
  DailyActivity,
  MoodTrendPoint,
  StatsSummary,
} from '@mindspace/shared';
import { query } from '../db/pool.ts';
import {
  addDays,
  computeLongestStreak,
  computeStreak,
  dateRange,
  localDate,
} from '../lib/dates.ts';
import { remainingForMonth, restDates } from './streak.ts';

/** Distinct days the user completed at least one session, newest first. */
async function activeDates(userId: string): Promise<string[]> {
  const { rows } = await query<{ activity_date: string }>(
    `SELECT DISTINCT activity_date
       FROM session_completions
      WHERE user_id = $1::uuid
      ORDER BY activity_date DESC`,
    [userId],
  );
  return rows.map((r) => r.activity_date);
}

export async function getStreak(userId: string, timezone: string): Promise<number> {
  const [dates, rests] = await Promise.all([activeDates(userId), restDates(userId)]);
  return computeStreak(dates, localDate(timezone), rests);
}

/** Per-day minutes and session counts between two local dates, inclusive. */
async function activityBetween(
  userId: string,
  from: string,
  to: string,
): Promise<Map<string, DailyActivity>> {
  const { rows } = await query<{
    activity_date: string;
    minutes: number;
    session_count: number;
  }>(
    `SELECT activity_date,
            -- Round per day, not per session, so three 50-second sessions
            -- read as 2 minutes rather than being floored away to 0.
            round(sum(seconds_listened) / 60.0)::int AS minutes,
            count(*)::int AS session_count
       FROM session_completions
      WHERE user_id = $1::uuid
        AND activity_date BETWEEN $2::date AND $3::date
      GROUP BY activity_date`,
    [userId, from, to],
  );

  return new Map(
    rows.map((r) => [
      r.activity_date,
      { date: r.activity_date, minutes: r.minutes, sessionCount: r.session_count },
    ]),
  );
}

/** Fills gaps so charts render a continuous axis rather than skipping days. */
function densify(activity: Map<string, DailyActivity>, from: string, to: string): DailyActivity[] {
  return dateRange(from, to).map(
    (date) => activity.get(date) ?? { date, minutes: 0, sessionCount: 0 },
  );
}

async function moodTrend(
  userId: string,
  from: string,
  to: string,
): Promise<MoodTrendPoint[]> {
  const { rows } = await query<{
    activity_date: string;
    average_value: number;
    entry_count: number;
  }>(
    `SELECT activity_date,
            avg(value)::numeric(4,2) AS average_value,
            count(*)::int AS entry_count
       FROM mood_entries
      WHERE user_id = $1::uuid
        AND activity_date BETWEEN $2::date AND $3::date
      GROUP BY activity_date
      ORDER BY activity_date`,
    [userId, from, to],
  );

  // Mood is only plotted where it was actually recorded — a gap means "no
  // check-in", which is not the same as a neutral score.
  return rows.map((r) => ({
    date: r.activity_date,
    averageValue: Number(r.average_value),
    entryCount: r.entry_count,
  }));
}

export interface AchievementProgress {
  streak: number;
  totalSessions: number;
  totalMinutes: number;
  coursesCompleted: number;
}

export async function getAchievementProgress(
  userId: string,
  timezone: string,
): Promise<AchievementProgress> {
  const [dates, rests, totals, courses] = await Promise.all([
    activeDates(userId),
    restDates(userId),
    query<{ total_sessions: number; total_minutes: number }>(
      `SELECT count(*)::int AS total_sessions,
              coalesce(round(sum(seconds_listened) / 60.0), 0)::int AS total_minutes
         FROM session_completions WHERE user_id = $1::uuid`,
      [userId],
    ),
    query<{ completed: number }>(
      `SELECT count(*)::int AS completed
         FROM course_enrollments
        WHERE user_id = $1::uuid AND completed_at IS NOT NULL`,
      [userId],
    ),
  ]);

  return {
    streak: computeStreak(dates, localDate(timezone), rests),
    totalSessions: totals.rows[0]?.total_sessions ?? 0,
    totalMinutes: totals.rows[0]?.total_minutes ?? 0,
    coursesCompleted: courses.rows[0]?.completed ?? 0,
  };
}

/** The full achievement catalogue with the caller's unlock state and progress. */
export async function getAchievements(
  userId: string,
  progress: AchievementProgress,
): Promise<Achievement[]> {
  const { rows } = await query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    icon: string;
    metric: 'streak' | 'total_sessions' | 'total_minutes' | 'courses_completed';
    threshold: number;
    unlocked_at: Date | null;
  }>(
    `SELECT a.id, a.slug, a.title, a.description, a.icon, a.metric, a.threshold,
            ua.unlocked_at
       FROM achievements a
       LEFT JOIN user_achievements ua
         ON ua.achievement_id = a.id AND ua.user_id = $1::uuid
      ORDER BY a.sort_order, a.threshold`,
    [userId],
  );

  const valueFor = (metric: string): number => {
    switch (metric) {
      case 'streak':
        return progress.streak;
      case 'total_sessions':
        return progress.totalSessions;
      case 'total_minutes':
        return progress.totalMinutes;
      case 'courses_completed':
        return progress.coursesCompleted;
      default:
        return 0;
    }
  };

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    icon: r.icon,
    unlockedAt: r.unlocked_at?.toISOString() ?? null,
    progress: Math.min(valueFor(r.metric), r.threshold),
    threshold: r.threshold,
  }));
}

/**
 * Awards any achievement whose threshold the user has now crossed and returns
 * only the newly unlocked ones, so the client can celebrate them once.
 */
export async function awardAchievements(
  userId: string,
  progress: AchievementProgress,
): Promise<Achievement[]> {
  const inserted = await query<{ achievement_id: string; unlocked_at: Date }>(
    `INSERT INTO user_achievements (user_id, achievement_id)
     SELECT $1::uuid, a.id
       FROM achievements a
      WHERE CASE a.metric
              WHEN 'streak'            THEN $2::int
              WHEN 'total_sessions'    THEN $3::int
              WHEN 'total_minutes'     THEN $4::int
              WHEN 'courses_completed' THEN $5::int
            END >= a.threshold
     -- Re-running is a no-op, so a replayed completion never double-celebrates.
     ON CONFLICT (user_id, achievement_id) DO NOTHING
     RETURNING achievement_id, unlocked_at`,
    [
      userId,
      progress.streak,
      progress.totalSessions,
      progress.totalMinutes,
      progress.coursesCompleted,
    ],
  );

  if (inserted.rows.length === 0) return [];

  const unlockedAt = new Map(
    inserted.rows.map((r) => [r.achievement_id, r.unlocked_at.toISOString()]),
  );

  const { rows } = await query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    icon: string;
    threshold: number;
  }>(
    `SELECT id, slug, title, description, icon, threshold
       FROM achievements
      WHERE id = ANY($1::uuid[])
      ORDER BY sort_order, threshold`,
    [[...unlockedAt.keys()]],
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    icon: r.icon,
    unlockedAt: unlockedAt.get(r.id) ?? new Date().toISOString(),
    progress: r.threshold,
    threshold: r.threshold,
  }));
}

/** Everything the Stats dashboard (screen 14) renders, in one round of queries. */
export async function getStatsSummary(
  userId: string,
  timezone: string,
): Promise<StatsSummary> {
  const today = localDate(timezone);
  const weekStart = addDays(today, -6);
  const yearStart = addDays(today, -364);
  const monthStart = addDays(today, -29);

  const [dates, rests, progress, yearActivity, mood7, mood30] = await Promise.all([
    activeDates(userId),
    restDates(userId),
    getAchievementProgress(userId, timezone),
    activityBetween(userId, yearStart, today),
    moodTrend(userId, weekStart, today),
    moodTrend(userId, monthStart, today),
  ]);

  const achievements = await getAchievements(userId, progress);

  const weeklyActivity = densify(yearActivity, weekStart, today);
  const minutesThisWeek = weeklyActivity.reduce((sum, d) => sum + d.minutes, 0);
  const sessionsThisWeek = weeklyActivity.reduce((sum, d) => sum + d.sessionCount, 0);

  return {
    currentStreak: progress.streak,
    longestStreak: computeLongestStreak(dates, rests),
    streakActiveToday: dates.includes(today),
    totalMinutes: progress.totalMinutes,
    totalSessions: progress.totalSessions,
    minutesThisWeek,
    sessionsThisWeek,
    weeklyActivity,
    // The heatmap only needs the days that have data; the client lays out the grid.
    heatmap: [...yearActivity.values()].sort((a, b) => a.date.localeCompare(b.date)),
    moodTrend7d: mood7,
    moodTrend30d: mood30,
    achievements,
    // Surfaced before one is needed: knowing the streak is already insured is
    // what defuses the panic, and costs nothing to show.
    restDaysRemaining: remainingForMonth(rests, today),
    restDatesUsed: rests.filter((d) => d >= yearStart),
  };
}
