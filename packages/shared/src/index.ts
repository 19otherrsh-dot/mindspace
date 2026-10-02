/**
 * Shared domain contract between the Mindspace API and the Expo client.
 * Everything the two sides exchange over HTTP is described here exactly once.
 */

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

/** Monetisation tiers from PRD §6. */
export type SubscriptionTier = 'free' | 'pro_monthly' | 'pro_annual' | 'teams';

/** Content categories from PRD §3.1 plus the Beginners browse chip. */
export type Category =
  | 'stress'
  | 'anxiety'
  | 'sleep'
  | 'focus'
  | 'relationships'
  | 'sports'
  | 'beginners';

/** How a piece of content behaves in the player. */
export type ContentFormat =
  | 'meditation'
  | 'sleepcast'
  | 'sleep_music'
  | 'focus_music'
  | 'mini'
  | 'movement'
  | 'wind_down'
  /** A silent timer with optional interval bells — no narration, no audio. */
  | 'unguided';

/** Narrator tone, surfaced as the "voice pack" picker in settings. */
export type VoicePack = 'calm' | 'warm' | 'neutral';

/** 1 = Anxious … 5 = Calm. Captured before and after every session. */
export type MoodValue = 1 | 2 | 3 | 4 | 5;

/** When a mood reading was taken relative to the session. */
export type MoodContext = 'pre_session' | 'post_session' | 'standalone';

export type ExperienceLevel = 'new' | 'some' | 'experienced';
export type SleepQuality = 'poor' | 'fair' | 'good';
export type AudioQuality = 'standard' | 'high';
export type ThemePreference = 'system' | 'light' | 'dark';

/** Sort orders offered on the category page (screen 8). */
export type SortOrder = 'popular' | 'new' | 'duration';

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export interface Instructor {
  id: string;
  name: string;
  /** Short bio shown on course detail pages (screen 13). */
  bio: string;
  avatarUrl: string | null;
  /** One-line billing under the name, e.g. "Former ER nurse". */
  tagline?: string | null;
  /** Populated on the teachers directory, not on embedded instructors. */
  slug?: string;
  sessionCount?: number;
  courseCount?: number;
  totalMinutes?: number;
}

/** Teacher detail: the instructor plus everything they narrate. */
export interface InstructorDetail extends Instructor {
  slug: string;
  sessions: Session[];
  courses: Course[];
}

/** A single playable piece of content in the library. */
export interface Session {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  category: Category;
  format: ContentFormat;
  /** Canonical length in seconds. */
  durationSeconds: number;
  voicePack: VoicePack | null;
  instructor: Instructor | null;
  artworkUrl: string;
  /** HLS manifest served from the CDN (PRD §5.1). */
  streamUrl: string;
  /** True when the session requires an active Pro subscription. */
  isPro: boolean;
  /** 0–5, averaged from user ratings. */
  rating: number;
  ratingCount: number;
  playCount: number;
  publishedAt: string;
  /** Populated per-request for the calling user. */
  isFavourite?: boolean;
  isDownloaded?: boolean;
}

export interface Collection {
  id: string;
  slug: string;
  title: string;
  description: string;
  heroArtworkUrl: string;
  /** Accent colour used for the hero banner gradient. */
  accentColor: string;
  category: Category | null;
  sessionCount: number;
  /** Only present on the collection detail response. */
  sessions?: Session[];
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export interface CourseDay {
  /** 1-indexed position within the course. */
  dayNumber: number;
  title: string;
  session: Session;
  /** False until the preceding day has been completed. */
  isUnlocked: boolean;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  description: string;
  artworkUrl: string;
  accentColor: string;
  instructor: Instructor | null;
  totalDays: number;
  isPro: boolean;
  rating: number;
  ratingCount: number;
  /** Present once the caller has enrolled. */
  enrollment: CourseEnrollment | null;
  /** Only present on the course detail response. */
  days?: CourseDay[];
}

export interface CourseEnrollment {
  courseId: string;
  enrolledAt: string;
  /** Highest day number completed; 0 when enrolled but not started. */
  daysCompleted: number;
  /** The day the Resume CTA should open. */
  nextDayNumber: number;
  completedAt: string | null;
  certificateUrl: string | null;
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Guests get a full account record but no credentials. */
  isGuest: boolean;
  subscriptionTier: SubscriptionTier;
  subscriptionRenewsAt: string | null;
  trialEndsAt: string | null;
  memberSince: string;
  preferences: UserPreferences;
  onboarding: OnboardingProfile | null;
}

export interface UserPreferences {
  reminderEnabled: boolean;
  /** "HH:MM" in the user's local timezone. */
  reminderTime: string;
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  reminderDays: number[];
  reminderMessage: string;
  /**
   * The bedtime wind-down nudge — a second daily touchpoint on its own
   * channel, so it can be silenced without losing the practice reminder.
   * Off by default: an unrequested notification at night is an intrusion.
   */
  bedtimeEnabled: boolean;
  /** "HH:MM" in the user's local timezone. */
  bedtimeTime: string;
  backgroundSoundEnabled: boolean;
  audioQuality: AudioQuality;
  theme: ThemePreference;
  preferredVoicePack: VoicePack;
  downloadOverCellular: boolean;
}

/** One night's sleep, reported the next day. 1 = badly … 5 = well. */
export type SleepValue = 1 | 2 | 3 | 4 | 5;

export interface SleepEntry {
  id: string;
  /** The night being reported on, "YYYY-MM-DD". */
  nightDate: string;
  quality: SleepValue;
  note: string | null;
  recordedAt: string;
}

/** Answers to the 5-question onboarding quiz (screen 4). */
export interface OnboardingProfile {
  goals: Category[];
  experienceLevel: ExperienceLevel;
  sleepQuality: SleepQuality;
  /** Minutes the user says they can commit each day. */
  dailyMinutes: number;
  preferredTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'flexible';
  completedAt: string;
}

/* ------------------------------------------------------------------ */
/* Activity, mood and progress                                         */
/* ------------------------------------------------------------------ */

export interface SessionCompletion {
  id: string;
  sessionId: string;
  session: Session | null;
  startedAt: string;
  completedAt: string;
  /** Seconds actually listened, which may be less than the full duration. */
  secondsListened: number;
  /** True when the user reached the end rather than exiting early. */
  finished: boolean;
  courseId: string | null;
  courseDayNumber: number | null;
}

export interface MoodEntry {
  id: string;
  value: MoodValue;
  context: MoodContext;
  note: string | null;
  sessionId: string | null;
  recordedAt: string;
}

export interface Achievement {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  /** Null until the user earns it. */
  unlockedAt: string | null;
  /** Current value toward the threshold, for progress rings on locked badges. */
  progress: number;
  threshold: number;
}

export interface DailyActivity {
  /** "YYYY-MM-DD" in the user's timezone. */
  date: string;
  minutes: number;
  sessionCount: number;
}

export interface MoodTrendPoint {
  date: string;
  averageValue: number;
  entryCount: number;
}

/** Everything screen 14 renders, in one payload. */
export interface StatsSummary {
  currentStreak: number;
  longestStreak: number;
  /** True once today has a completed session, so the flame renders lit. */
  streakActiveToday: boolean;
  totalMinutes: number;
  totalSessions: number;
  minutesThisWeek: number;
  sessionsThisWeek: number;
  /** Last 7 days, oldest first — drives the weekly bar chart. */
  weeklyActivity: DailyActivity[];
  /** Up to 365 days for the calendar heatmap. */
  heatmap: DailyActivity[];
  moodTrend7d: MoodTrendPoint[];
  moodTrend30d: MoodTrendPoint[];
  achievements: Achievement[];
  /**
   * Rest days left this calendar month. A rest day forgives one missed day so
   * the streak survives it — shown before one is needed, because knowing the
   * streak is insured is what stops a missed day feeling like a failure.
   */
  restDaysRemaining: number;
  /** Days already forgiven, so the heatmap can mark them apart from practice. */
  restDatesUsed: string[];
}

/* ------------------------------------------------------------------ */
/* Home feed                                                           */
/* ------------------------------------------------------------------ */

export interface FeedSection {
  id: string;
  title: string;
  subtitle: string | null;
  /** Controls the card size the client renders for this row. */
  layout: 'hero' | 'carousel' | 'grid';
  sessions: Session[];
}

export interface HomeFeed {
  /** "Good morning" / "Good evening" — resolved server-side against the user's timezone. */
  greeting: string;
  displayName: string;
  /** The single hero recommendation. */
  daily: Session;
  dailyReason: string;
  /** In-progress course surfaced above the fold, when there is one. */
  continueCourse: Course | null;
  sections: FeedSection[];
  streak: number;
  /** True when the user has not checked in today, so Home shows the CTA. */
  needsMoodCheckIn: boolean;
  /**
   * Distinct days practised, capped at {@link FIRST_TEN_DAYS}. Ten days is the
   * strongest known predictor of long-term retention, so Home carries a
   * visible commitment surface until it is reached, then stops.
   */
  practiceDays: number;
}

/* ------------------------------------------------------------------ */
/* AI companion                                                        */
/* ------------------------------------------------------------------ */

export type CompanionRole = 'user' | 'assistant';
export type CompanionRisk = 'none' | 'elevated' | 'crisis';

export interface CompanionMessage {
  id: string;
  role: CompanionRole;
  content: string;
  risk: CompanionRisk;
  createdAt: string;
}

export interface CompanionConversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: CompanionMessage[];
}

/** A verified helpline. Never model-generated — see the API's safety module. */
export interface CrisisResource {
  region: string;
  name: string;
  contact: string;
  detail: string;
  url?: string;
}

/** What the client learns about companion availability before opening it. */
export interface CompanionStatus {
  /** False when no model provider is configured for this deployment. */
  available: boolean;
  /** Present only in development, to make provider swaps visible. */
  provider?: string;
  model?: string;
  /** Always populated, regardless of availability or subscription tier. */
  crisisResources: CrisisResource[];
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* Therapy                                                             */
/* ------------------------------------------------------------------ */

export interface TherapistLicence {
  jurisdiction: string;
  licenceBody: string;
  licenceNumber: string;
  expiresOn: string | null;
}

export interface Therapist {
  id: string;
  slug: string;
  fullName: string;
  credentials: string;
  headline: string;
  bio: string;
  avatarUrl: string | null;
  timezone: string;
  languages: string[];
  specialties: string[];
  sessionPriceCents: number;
  currency: string;
  sessionMinutes: number;
  acceptingClients: boolean;
  licences: TherapistLicence[];
  /** True when this therapist is licensed where the caller is. */
  availableInYourRegion: boolean;
}

/** A bookable start time, always an absolute instant. */
export interface AppointmentSlot {
  startsAt: string;
  endsAt: string;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled_by_client'
  | 'cancelled_by_therapist'
  | 'no_show';

export interface Appointment {
  id: string;
  therapist: Pick<Therapist, 'id' | 'slug' | 'fullName' | 'credentials' | 'avatarUrl'>;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  /** Jitsi room URL; only meaningful close to the appointment time. */
  videoUrl: string;
  note: string | null;
  priceCents: number;
  currency: string;
  createdAt: string;
}

export interface BookAppointmentRequest {
  therapistId: string;
  startsAt: string;
  note?: string;
  /** ISO 3166 region the client is in, e.g. "US-CA". */
  jurisdiction: string;
}

export function formatPrice(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  return symbol ? `${symbol}${(cents / 100).toFixed(0)}` : `${(cents / 100).toFixed(0)} ${currency}`;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

/* ------------------------------------------------------------------ */
/* Request payloads                                                    */
/* ------------------------------------------------------------------ */

export interface SignUpRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface LogInRequest {
  email: string;
  password: string;
}

/** Converts an anonymous guest account into a full one, keeping its history. */
export interface ConvertGuestRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface CompleteSessionRequest {
  sessionId: string;
  startedAt: string;
  secondsListened: number;
  finished: boolean;
  courseId?: string;
  courseDayNumber?: number;
}

export interface RecordMoodRequest {
  value: MoodValue;
  context: MoodContext;
  note?: string;
  sessionId?: string;
}

export interface SubscribeRequest {
  tier: Exclude<SubscriptionTier, 'free'>;
  /** Receipt from the App Store / Play Store IAP flow. */
  receipt: string;
  startTrial?: boolean;
}

export interface ExploreQuery {
  q?: string;
  category?: Category;
  format?: ContentFormat;
  /** Filter chips: "short" is <= 10 min, "long" is > 10 min. */
  length?: 'short' | 'long';
  freeOnly?: boolean;
  sort?: SortOrder;
  limit?: number;
  offset?: number;
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** What the client shows on the post-session summary (screen 11). */
export interface CompleteSessionResponse {
  completion: SessionCompletion;
  streak: number;
  streakIncreased: boolean;
  minutesThisWeek: number;
  totalMinutes: number;
  /** Badges unlocked by this session, for the celebration animation. */
  newAchievements: Achievement[];
  /** Set when the session was the last day of a course. */
  courseCompleted: boolean;
  certificateUrl: string | null;
  /**
   * The missed day a rest day just covered, when returning after one day off.
   * The summary screen says the streak was protected rather than letting the
   * user assume it broke.
   */
  streakProtectedDate: string | null;
  /** Rest days left this month, after any spend above. */
  restDaysRemaining: number;
  /** Distinct days practised, capped at {@link FIRST_TEN_DAYS}. */
  practiceDays: number;
  /**
   * True only on the session that completes the tenth day.
   *
   * The milestone is celebrated the moment it is earned rather than noticed on
   * the next visit home, and this flag is what makes that possible.
   */
  reachedFirstTenDays: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Field-level detail for validation failures. */
    details?: Record<string, string>;
  };
}

/* ------------------------------------------------------------------ */
/* Constants shared by both sides                                      */
/* ------------------------------------------------------------------ */

/** Session lengths offered in the library (PRD §3.1), in minutes. */
export const SESSION_LENGTHS = [3, 5, 10, 15, 20, 30] as const;

/**
 * Durations offered by the unguided timer. The seed creates one `unguided`
 * session per entry and the client looks them up by duration, so both sides
 * must agree — which is why this lives here rather than in either app.
 */
export const TIMER_DURATIONS = [3, 5, 10, 15, 20, 30, 45, 60] as const;

/** Slug for the seeded timer session of a given length. */
export function unguidedSlug(minutes: number): string {
  return `unguided-${minutes}`;
}

/** Sessions a free user may play (PRD §6). */
export const FREE_SESSION_LIMIT = 10;

/**
 * The first ten days of practice.
 *
 * Users who practise ten days retain at materially higher rates months later,
 * which makes this the one milestone worth building the early experience
 * around rather than leaving it as one course among many.
 */
export const FIRST_TEN_DAYS = 10;

/** Offline downloads allowed on Pro (PRD §3.1). */
export const PRO_DOWNLOAD_LIMIT = 50;

/**
 * Offline downloads allowed on the free tier.
 *
 * Deliberately small but non-zero. A prospective user's sense of what "free"
 * should include is now set by libraries that give away hundreds of thousands
 * of tracks, and someone who can never take a session onto a plane or a subway
 * never discovers whether the habit sticks. Free downloads cover free content
 * only — Pro sessions still require a subscription.
 */
export const FREE_DOWNLOAD_LIMIT = 3;

/** Offline downloads allowed for a given tier. */
export function downloadLimitFor(tier: SubscriptionTier): number {
  return isPro(tier) ? PRO_DOWNLOAD_LIMIT : FREE_DOWNLOAD_LIMIT;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  stress: 'Stress',
  anxiety: 'Anxiety',
  sleep: 'Sleep',
  focus: 'Focus',
  relationships: 'Relationships',
  sports: 'Sports',
  beginners: 'Beginners',
};

export const MOOD_LABELS: Record<MoodValue, string> = {
  1: 'Anxious',
  2: 'Uneasy',
  3: 'Okay',
  4: 'Good',
  5: 'Calm',
};

export const MOOD_EMOJI: Record<MoodValue, string> = {
  1: '😰',
  2: '😕',
  3: '😐',
  4: '🙂',
  5: '😌',
};

export function isPro(tier: SubscriptionTier): boolean {
  return tier === 'pro_monthly' || tier === 'pro_annual' || tier === 'teams';
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
