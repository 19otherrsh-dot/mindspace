import { Router } from 'express';
import {
  FIRST_TEN_DAYS,
  type Category,
  type ExperienceLevel,
  type FeedSection,
  type HomeFeed,
  type Session,
  type SleepQuality,
} from '@mindspace/shared';
import { query, queryOne } from '../db/pool.ts';
import { greetingFor, localDate, localHour } from '../lib/dates.ts';
import { notFound } from '../lib/errors.ts';
import { hasProAccess, requireAuth } from '../middleware/auth.ts';
import { mapSession, type SessionRow, SESSION_SELECT } from '../services/content.ts';
import { getActiveCourse } from '../services/courses.ts';
import { getStreak } from '../services/stats.ts';
import { cacheGet, cacheSet } from '../redis.ts';

export const homeRouter = Router();

/** Feed is cheap to rebuild but hot on app open; a short TTL is enough. */
const FEED_TTL_SECONDS = 300;

async function runSessionQuery(
  sql: string,
  params: unknown[],
): Promise<Session[]> {
  const { rows } = await query<SessionRow>(sql, params);
  return rows.map(mapSession);
}

export interface DailyPreferences {
  goals: Category[];
  /** Minutes the user said they could give it. */
  dailyMinutes: number | null;
  experienceLevel: ExperienceLevel | null;
  /** Whether the user can actually play Pro audio. */
  hasPro: boolean;
}

/**
 * The daily hero, chosen from what the user actually told us in the quiz.
 *
 * All three answers matter: the goals decide the subject, the stated minutes
 * decide the length, and a beginner is steered toward beginner content. Asking
 * someone how much time they have and then offering a twenty-minute sit is
 * how a personalisation quiz stops being believed.
 *
 * The pick is stable for the whole day — the shuffle is seeded with the date,
 * because users find it unsettling when the hero changes mid-morning.
 */
async function pickDaily(
  userId: string,
  preferences: DailyPreferences,
  today: string,
): Promise<{ session: Session | null; reason: string }> {
  const { goals, dailyMinutes, experienceLevel, hasPro } = preferences;

  /*
   * A beginner is offered beginner content even when they did not name it as a
   * goal — 'beginners' is a browse chip rather than a subject, so folding it in
   * widens the pool rather than narrowing it.
   */
  const categories: Category[] =
    experienceLevel === 'new' && goals.length > 0
      ? [...new Set<Category>([...goals, 'beginners'])]
      : goals;

  /**
   * Runs the pick, optionally constrained to sessions near the user's stated
   * length. Placeholders are numbered as the parameters are pushed, because
   * Postgres rejects a statement that binds a parameter it never references.
   */
  async function attempt(withDuration: boolean): Promise<Session[]> {
    const params: unknown[] = [userId];
    const clauses: string[] = [];

    /*
     * The hero is the app's one-tap action — from Home, from the widget, from
     * a tapped reminder — so it has to be something this user can actually
     * play. Recommending locked audio turns the primary action into a paywall
     * and makes the reminder a dead end. Pro content still fills the browse
     * rows, where a lock is an invitation rather than an obstacle.
     */
    if (!hasPro) {
      clauses.push('AND s.is_pro = FALSE');
    }

    if (categories.length > 0) {
      params.push(categories);
      clauses.push(`AND s.category = ANY($${params.length}::content_category[])`);
    }

    if (withDuration && dailyMinutes) {
      // A generous window: close enough to honour the answer, wide enough that
      // a small library still has something to offer.
      params.push(Math.round(dailyMinutes * 60 * 0.4));
      const floor = params.length;
      params.push(Math.round(dailyMinutes * 60 * 1.75));
      clauses.push(`AND s.duration_seconds BETWEEN $${floor} AND $${params.length}`);
    }

    params.push(today);
    const dateParam = params.length;

    /*
     * Order by closeness to the stated length first, then by the stable daily
     * hash, so the pick is both well-fitted and steady through the day.
     *
     * Closeness applies on the fallback pass too: when nothing sits inside the
     * window, the nearest length is still a better answer than a random one.
     */
    const target = dailyMinutes ? dailyMinutes * 60 : null;
    let ordering = `md5(s.id::text || $${dateParam})`;
    if (target !== null) {
      params.push(target);
      ordering = `abs(s.duration_seconds - $${params.length}) / 60, md5(s.id::text || $${dateParam})`;
    }

    return runSessionQuery(
      `${SESSION_SELECT}
        WHERE s.is_active
          AND s.format IN ('meditation', 'mini')
          ${clauses.join('\n          ')}
          -- Do not re-recommend something already done today.
          AND NOT EXISTS (
            SELECT 1 FROM session_completions sc
             WHERE sc.user_id = $1::uuid
               AND sc.session_id = s.id
               AND sc.activity_date = $${dateParam}::date
          )
        ORDER BY ${ordering}
        LIMIT 1`,
      params,
    );
  }

  /*
   * Length is a preference, not a requirement: never leave the hero empty
   * because nothing matched the window. `matchedLength` records whether the
   * answer was actually honoured, so the reason line does not claim a fit the
   * library could not provide.
   */
  let sessions = await attempt(true);
  let matchedLength = sessions.length > 0 && Boolean(dailyMinutes);
  if (sessions.length === 0) {
    sessions = await attempt(false);
    matchedLength = false;
  }

  const session = sessions[0] ?? null;

  let reason = 'A good place to start today';
  if (matchedLength && goals.length > 0) {
    reason = `${dailyMinutes} minutes, for the goals you set`;
  } else if (matchedLength) {
    reason = `About ${dailyMinutes} minutes, as you asked`;
  } else if (goals.length > 0) {
    reason = 'Chosen for the goals you set';
  }

  return { session, reason };
}

/** GET /home — the Today feed (screen 5). */
homeRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!;
  const cacheKey = `feed:${user.id}`;

  const cached = await cacheGet<HomeFeed>(cacheKey);
  if (cached) return res.json(cached);

  const today = localDate(user.timezone);

  const profile = await queryOne<{
    display_name: string;
    goals: Category[] | null;
    daily_minutes: number | null;
    experience_level: ExperienceLevel | null;
    sleep_quality: SleepQuality | null;
  }>(
    // goals is cast to text[] because node-pg cannot parse an array of a
    // custom enum and would otherwise return the literal '{sleep}' as a string.
    `SELECT u.display_name, o.goals::text[] AS goals,
            o.daily_minutes, o.experience_level, o.sleep_quality
       FROM users u
       LEFT JOIN onboarding_profiles o ON o.user_id = u.id
      WHERE u.id = $1::uuid`,
    [user.id],
  );
  if (!profile) throw notFound('User');

  const goals = profile.goals ?? [];
  const sleepsBadly = profile.sleep_quality === 'poor';

  const [
    daily,
    continueSessions,
    trending,
    streak,
    activeCourse,
    moodToday,
    practiceDays,
  ] = await Promise.all([
    pickDaily(
      user.id,
      {
        goals,
        dailyMinutes: profile.daily_minutes,
        experienceLevel: profile.experience_level,
        hasPro: hasProAccess(user),
      },
      today,
    ),

    // "Continue where you left off" — recent plays the user did not finish.
    runSessionQuery(
      `${SESSION_SELECT}
        WHERE s.is_active AND s.id IN (
          SELECT DISTINCT ON (sc.session_id) sc.session_id
            FROM session_completions sc
           WHERE sc.user_id = $1::uuid AND NOT sc.finished
           ORDER BY sc.session_id, sc.completed_at DESC
        )
        ORDER BY s.title
        LIMIT 10`,
      [user.id],
    ),

    runSessionQuery(
      `${SESSION_SELECT}
        WHERE s.is_active AND s.published_at > now() - interval '90 days'
        ORDER BY s.play_count DESC
        LIMIT 10`,
      [user.id],
    ),

    getStreak(user.id, user.timezone),
    getActiveCourse(user.id),

    queryOne<{ value: number }>(
      `SELECT value FROM mood_entries
        WHERE user_id = $1::uuid AND activity_date = $2::date
        ORDER BY recorded_at DESC LIMIT 1`,
      [user.id, today],
    ),

    // Distinct days, not sessions: three sittings in one evening is one day of
    // the habit. Counting stops at the milestone so the query stays cheap once
    // the card is gone for good.
    queryOne<{ days: number }>(
      `SELECT count(*)::int AS days
         FROM (
           SELECT DISTINCT activity_date
             FROM session_completions
            WHERE user_id = $1::uuid
            LIMIT $2
         ) AS practised`,
      [user.id, FIRST_TEN_DAYS],
    ),
  ]);

  // "Based on your mood": a low reading pulls calming content forward, a high
  // one leans into focus. Without a check-in the row is simply omitted.
  let moodSessions: Session[] = [];
  if (moodToday) {
    const moodCategories: Category[] =
      moodToday.value <= 2 ? ['anxiety', 'stress'] : moodToday.value === 3 ? ['stress', 'focus'] : ['focus', 'sports'];

    moodSessions = await runSessionQuery(
      `${SESSION_SELECT}
        WHERE s.is_active AND s.category = ANY($2::content_category[])
        ORDER BY s.rating_sum DESC, s.play_count DESC
        LIMIT 10`,
      [user.id, moodCategories],
    );
  }

  /*
   * Sleep content appears in the evening for everyone, and all day for someone
   * who told us they sleep badly — the quiz asks the question, so the answer
   * should be visible in what the app offers rather than only stored.
   */
  const eveningNow = localHour(user.timezone) >= 20;
  const showSleepRow = eveningNow || sleepsBadly;
  const windDown = showSleepRow
    ? await runSessionQuery(
        `${SESSION_SELECT}
          WHERE s.is_active AND s.format IN ('sleepcast', 'wind_down', 'sleep_music')
          ORDER BY s.play_count DESC
          LIMIT 10`,
        [user.id],
      )
    : [];

  if (!daily.session) throw notFound('Recommended session');

  const sections: FeedSection[] = [];

  if (continueSessions.length > 0) {
    sections.push({
      id: 'continue',
      title: 'Continue where you left off',
      subtitle: null,
      layout: 'carousel',
      sessions: continueSessions,
    });
  }

  if (windDown.length > 0) {
    sections.push({
      id: 'wind-down',
      title: eveningNow ? 'Wind down for the night' : 'For better sleep',
      subtitle: sleepsBadly && !eveningNow
        ? 'You said sleep is hard at the moment — these are for tonight'
        : 'Sleepcasts and soundscapes to drift off to',
      layout: 'carousel',
      sessions: windDown,
    });
  }

  sections.push({
    id: 'trending',
    title: 'Trending this week',
    subtitle: null,
    layout: 'carousel',
    sessions: trending,
  });

  if (moodSessions.length > 0) {
    sections.push({
      id: 'mood',
      title: 'Based on your mood',
      subtitle: 'Picked from how you were feeling today',
      layout: 'grid',
      sessions: moodSessions,
    });
  }

  const pro = hasProAccess(user);
  const gate = (list: Session[]) =>
    list.map((s) => (s.isPro && !pro ? { ...s, streamUrl: '' } : s));

  const feed: HomeFeed = {
    greeting: greetingFor(user.timezone),
    displayName: profile.display_name,
    daily: gate([daily.session])[0]!,
    dailyReason: daily.reason,
    continueCourse: activeCourse,
    sections: sections.map((s) => ({ ...s, sessions: gate(s.sessions) })),
    streak,
    needsMoodCheckIn: moodToday === null,
    practiceDays: practiceDays?.days ?? 0,
  };

  await cacheSet(cacheKey, feed, FEED_TTL_SECONDS);
  res.json(feed);
});
