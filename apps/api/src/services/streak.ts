import { query } from '../db/pool.ts';
import { addDays, localDate } from '../lib/dates.ts';

/**
 * Streak insurance.
 *
 * Users cancel after losing a streak, and Mindspace's gamification is heavy —
 * streaks, heatmaps, achievement thresholds — with nothing to absorb a single
 * bad day. A rest day forgives one missed day so the run continues.
 *
 * Two rules keep it from hollowing the streak out:
 *
 *  - It only ever bridges a *one-day* gap between two runs. A week away is a
 *    broken streak, and should be.
 *  - A spend is written to `streak_rest_days` and never recomputed, so the
 *    same gap cannot be forgiven twice and the allowance is genuinely finite.
 */

/** Rest days earned per calendar month. Deliberately scarce. */
export const RESTS_PER_MONTH = 1;

/** "YYYY-MM" — rest days are budgeted by the month the missed day falls in. */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Every date this user has had forgiven, newest first. */
export async function restDates(userId: string): Promise<string[]> {
  const { rows } = await query<{ rest_date: string }>(
    `SELECT to_char(rest_date, 'YYYY-MM-DD') AS rest_date
       FROM streak_rest_days
      WHERE user_id = $1::uuid
      ORDER BY rest_date DESC`,
    [userId],
  );
  return rows.map((r) => r.rest_date);
}

/** How many rest days remain in the month containing `date`. */
export function remainingForMonth(spent: readonly string[], date: string): number {
  const month = monthOf(date);
  const used = spent.filter((d) => monthOf(d) === month).length;
  return Math.max(0, RESTS_PER_MONTH - used);
}

export interface StreakProtection {
  /** The date that was forgiven, when this call spent a rest day. */
  protectedDate: string | null;
  /** Rest days left in the current local month, after any spend above. */
  remaining: number;
}

/**
 * Spends a rest day if the user has just returned after exactly one missed day.
 *
 * Called on completion — the moment the user comes back is precisely when the
 * repair is worth making and worth telling them about. Safe to call repeatedly:
 * the insert is keyed on (user, date) and does nothing the second time.
 */
export async function applyStreakProtection(
  userId: string,
  timezone: string,
): Promise<StreakProtection> {
  const today = localDate(timezone);
  const spent = await restDates(userId);

  const candidate = addDays(today, -1);

  // Already forgiven, or no allowance left this month — nothing to do.
  if (spent.includes(candidate) || remainingForMonth(spent, candidate) === 0) {
    return { protectedDate: null, remaining: remainingForMonth(spent, today) };
  }

  /*
   * Only bridge a gap. Yesterday must be missed, and the day before it must
   * have been practised (or itself forgiven) — otherwise there is no run on
   * the far side to join, and forgiving the day would invent a streak rather
   * than protect one.
   */
  const dayBefore = addDays(candidate, -1);
  const { rows } = await query<{ missed_yesterday: boolean; active_before: boolean }>(
    `SELECT
       NOT EXISTS (
         SELECT 1 FROM session_completions
          WHERE user_id = $1::uuid AND activity_date = $2::date
       ) AS missed_yesterday,
       EXISTS (
         SELECT 1 FROM session_completions
          WHERE user_id = $1::uuid AND activity_date = $3::date
       ) AS active_before`,
    [userId, candidate, dayBefore],
  );

  const gap = rows[0];
  const bridgeable =
    (gap?.missed_yesterday ?? false) &&
    ((gap?.active_before ?? false) || spent.includes(dayBefore));

  if (!bridgeable) {
    return { protectedDate: null, remaining: remainingForMonth(spent, today) };
  }

  const inserted = await query<{ rest_date: string }>(
    `INSERT INTO streak_rest_days (user_id, rest_date)
     VALUES ($1::uuid, $2::date)
     ON CONFLICT (user_id, rest_date) DO NOTHING
     RETURNING to_char(rest_date, 'YYYY-MM-DD') AS rest_date`,
    [userId, candidate],
  );

  const protectedDate = inserted.rows[0]?.rest_date ?? null;
  const after = protectedDate ? [...spent, protectedDate] : spent;

  return { protectedDate, remaining: remainingForMonth(after, today) };
}

/**
 * Rest days left this month, for surfacing before one is needed — telling
 * someone their streak is already insured is what prevents the panic, and it
 * costs no write.
 */
export async function remainingRestDays(
  userId: string,
  timezone: string,
): Promise<number> {
  return remainingForMonth(await restDates(userId), localDate(timezone));
}
