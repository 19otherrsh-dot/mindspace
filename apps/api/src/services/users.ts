import type {
  AudioQuality,
  Category,
  ExperienceLevel,
  SleepQuality,
  SubscriptionTier,
  ThemePreference,
  User,
  VoicePack,
} from '@mindspace/shared';
import { queryOne } from '../db/pool.ts';

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  is_guest: boolean;
  subscription_tier: SubscriptionTier;
  subscription_renews_at: Date | null;
  trial_ends_at: Date | null;
  created_at: Date;
  reminder_enabled: boolean;
  reminder_time: string;
  reminder_days: number[];
  reminder_message: string;
  bedtime_enabled: boolean;
  bedtime_time: string;
  background_sound_enabled: boolean;
  audio_quality: AudioQuality;
  theme: ThemePreference;
  preferred_voice_pack: VoicePack;
  download_over_cellular: boolean;
  goals: Category[] | null;
  experience_level: ExperienceLevel | null;
  sleep_quality: SleepQuality | null;
  daily_minutes: number | null;
  preferred_time: 'morning' | 'afternoon' | 'evening' | 'flexible' | null;
  onboarding_completed_at: Date | null;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_guest,
         u.subscription_tier, u.subscription_renews_at, u.trial_ends_at, u.created_at,
         p.reminder_enabled, p.reminder_time, p.reminder_days, p.reminder_message,
         p.bedtime_enabled, p.bedtime_time,
         p.background_sound_enabled, p.audio_quality, p.theme,
         p.preferred_voice_pack, p.download_over_cellular,
         -- Cast to text[]: node-pg has no parser for an array of a custom
         -- enum and hands back the raw literal '{stress,sleep}' as a string,
         -- which then lies about its type all the way to the client.
         o.goals::text[] AS goals,
         o.experience_level, o.sleep_quality, o.daily_minutes,
         o.preferred_time, o.completed_at AS onboarding_completed_at
    FROM users u
    JOIN user_preferences p ON p.user_id = u.id
    LEFT JOIN onboarding_profiles o ON o.user_id = u.id
`;

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    isGuest: row.is_guest,
    subscriptionTier: row.subscription_tier,
    subscriptionRenewsAt: row.subscription_renews_at?.toISOString() ?? null,
    trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
    memberSince: row.created_at.toISOString(),
    preferences: {
      reminderEnabled: row.reminder_enabled,
      // TIME comes back as "HH:MM:SS"; the client only ever shows HH:MM.
      reminderTime: row.reminder_time.slice(0, 5),
      reminderDays: row.reminder_days ?? [],
      reminderMessage: row.reminder_message,
      bedtimeEnabled: row.bedtime_enabled,
      bedtimeTime: row.bedtime_time.slice(0, 5),
      backgroundSoundEnabled: row.background_sound_enabled,
      audioQuality: row.audio_quality,
      theme: row.theme,
      preferredVoicePack: row.preferred_voice_pack,
      downloadOverCellular: row.download_over_cellular,
    },
    onboarding: row.onboarding_completed_at
      ? {
          goals: row.goals ?? [],
          experienceLevel: row.experience_level ?? 'new',
          sleepQuality: row.sleep_quality ?? 'fair',
          dailyMinutes: row.daily_minutes ?? 10,
          preferredTimeOfDay: row.preferred_time ?? 'flexible',
          completedAt: row.onboarding_completed_at.toISOString(),
        }
      : null,
  };
}

export async function getUserById(userId: string): Promise<User | null> {
  const row = await queryOne<UserRow>(
    `${USER_SELECT} WHERE u.id = $1::uuid AND u.deleted_at IS NULL`,
    [userId],
  );
  return row ? mapUser(row) : null;
}

export async function findByEmail(
  email: string,
): Promise<{ id: string; passwordHash: string | null; isGuest: boolean } | null> {
  const row = await queryOne<{ id: string; password_hash: string | null; is_guest: boolean }>(
    'SELECT id, password_hash, is_guest FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email],
  );
  return row ? { id: row.id, passwordHash: row.password_hash, isGuest: row.is_guest } : null;
}

export { mapUser, USER_SELECT };
export type { UserRow };
