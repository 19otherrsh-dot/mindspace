/**
 * Every "day" in Mindspace — streaks, the heatmap, the daily recommendation —
 * is a calendar day in the *user's* timezone, not the server's. These helpers
 * are the only place that conversion happens.
 */

/** "YYYY-MM-DD" for the given instant in the given IANA zone. */
export function localDate(timezone: string, at: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    // An unknown zone (client sent junk) falls back to UTC rather than throwing
    // mid-write and losing the user's completed session.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }
}

/** Local hour 0–23, used to pick the greeting on the home feed. */
export function localHour(timezone: string, at: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(at),
    );
  } catch {
    return at.getUTCHours();
  }
}

/** Shifts a "YYYY-MM-DD" string by whole days without touching timezones. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy!, fm! - 1, fd!);
  const b = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((b - a) / 86_400_000);
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; daysBetween(d, end) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Consecutive days ending today — or yesterday, which keeps the streak alive
 * until the user's day is actually over rather than resetting it at midnight.
 *
 * @param activeDates distinct "YYYY-MM-DD" days with a completed session
 * @param today the user's current local date
 * @param restDates days forgiven by a rest day, which count as practised.
 *   These are only ever recorded for a genuine one-day gap between two runs
 *   (see `services/streak.ts`), so treating them as active here cannot bridge
 *   an arbitrary absence.
 */
export function computeStreak(
  activeDates: string[],
  today: string,
  restDates: readonly string[] = [],
): number {
  if (activeDates.length === 0) return 0;

  const days = new Set([...activeDates, ...restDates]);
  const yesterday = addDays(today, -1);

  let cursor: string;
  if (days.has(today)) {
    cursor = today;
  } else if (days.has(yesterday)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The best run anywhere in the user's history, for the Stats screen. */
export function computeLongestStreak(
  activeDates: string[],
  restDates: readonly string[] = [],
): number {
  if (activeDates.length === 0) return 0;

  const sorted = [...new Set([...activeDates, ...restDates])].sort();
  let longest = 1;
  let run = 1;

  for (let i = 1; i < sorted.length; i += 1) {
    if (daysBetween(sorted[i - 1]!, sorted[i]!) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return longest;
}

export function greetingFor(timezone: string, at: Date = new Date()): string {
  const hour = localHour(timezone, at);
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Validates a client-supplied IANA zone before it reaches the database. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
