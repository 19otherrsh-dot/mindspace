import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { UserPreferences } from '@mindspace/shared';

/**
 * Daily practice reminders — Headspace's "Mindful Moments".
 *
 * PRD §8 names habit formation as the highest-severity risk, and the reminder
 * schedule was already being stored server-side without anything delivering
 * it. These are *local* notifications: they need no push infrastructure, no
 * device tokens, and they keep firing offline.
 */

export const remindersSupported = Platform.OS !== 'web';

const ANDROID_CHANNEL = 'mindspace-reminders';

/** Marks a notification whose tap should start today's session directly. */
export const REMINDER_INTENT = 'start-daily';

/** Marks the bedtime nudge, which opens the wind-down rather than the daily. */
export const BEDTIME_INTENT = 'start-winddown';

const BEDTIME_CHANNEL = 'mindspace-bedtime';

/** Notifications shown while the app is foregrounded stay quiet and unobtrusive. */
export function configureNotificationHandler(): void {
  if (!remindersSupported) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // A reminder that makes a noise during a session would be self-defeating.
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Practice reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    // Deliberately gentle: no vibration pattern, no light.
    vibrationPattern: [0, 120],
    lightColor: '#5B7FFF',
  });

  // A separate channel so someone can silence bedtime without losing their
  // practice reminder, and quieter because it arrives as they are settling.
  await Notifications.setNotificationChannelAsync(BEDTIME_CHANNEL, {
    name: 'Bedtime wind-down',
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: [0],
    lightColor: '#8E7CFF',
  });
}

export async function hasPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  const settings = await Notifications.getPermissionsAsync();
  return (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

/** Prompts once. Returns false if the user declined or the OS refused. */
export async function requestPermission(): Promise<boolean> {
  if (!remindersSupported) return false;

  if (await hasPermission()) return true;

  const settings = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: false },
  });
  return settings.granted;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour: hour ?? 8, minute: minute ?? 0 };
}

/**
 * Rewrites the whole schedule from the user's preferences.
 *
 * Everything is cancelled first because reminders are the only notifications
 * this app schedules — a diff would be more code for no benefit, and would
 * risk leaving orphans behind when the day list shrinks.
 */
export async function syncReminders(preferences: UserPreferences): Promise<boolean> {
  if (!remindersSupported) return false;

  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!preferences.reminderEnabled) return true;

  if (!(await requestPermission())) return false;
  await ensureAndroidChannel();

  const { hour, minute } = parseTime(preferences.reminderTime);
  const content = {
    title: 'Mindspace',
    body: preferences.reminderMessage || 'Time to find your calm.',
    // Tapping the reminder should begin practice, not deposit the user on a
    // home screen to choose all over again. The app reads this on launch.
    data: { intent: REMINDER_INTENT } as const,
    ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
  };

  // An empty day list means every day.
  const everyDay = preferences.reminderDays.length === 0;

  if (everyDay) {
    await Notifications.scheduleNotificationAsync({
      content,
      trigger:
        Platform.OS === 'android'
          ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
          : // DAILY/WEEKLY are Android-only; iOS repeats via a calendar trigger.
            {
              type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
              hour,
              minute,
              repeats: true,
            },
    });
    return true;
  }

  for (const day of preferences.reminderDays) {
    // Our days are 0 = Sunday; expo-notifications uses 1 = Sunday.
    const weekday = day + 1;

    await Notifications.scheduleNotificationAsync({
      content,
      trigger:
        Platform.OS === 'android'
          ? { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour, minute }
          : {
              type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
              weekday,
              hour,
              minute,
              repeats: true,
            },
    });
  }

  return true;
}

/**
 * The bedtime nudge — a second daily touchpoint, anchored to winding down.
 *
 * A single reminder gives one chance a day to be caught at a good moment.
 * Bedtime is a different habit from the morning sit and deserves its own
 * anchor: it is when the sleep content we already publish is actually wanted.
 *
 * Scheduled alongside the practice reminder rather than replacing it, so
 * `syncReminders` clearing everything first must be followed by this call.
 */
export async function scheduleBedtime(preferences: UserPreferences): Promise<boolean> {
  if (!remindersSupported) return false;
  if (!preferences.bedtimeEnabled) return true;

  if (!(await requestPermission())) return false;
  await ensureAndroidChannel();

  const { hour, minute } = parseTime(preferences.bedtimeTime);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to wind down',
      body: 'A few minutes of breathing, then something to fall asleep to.',
      data: { intent: BEDTIME_INTENT } as const,
      ...(Platform.OS === 'android' ? { channelId: BEDTIME_CHANNEL } : {}),
    },
    trigger:
      Platform.OS === 'android'
        ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
        : {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour,
            minute,
            repeats: true,
          },
  });

  return true;
}

/**
 * Rewrites every channel. `syncReminders` cancels all pending notifications,
 * so the bedtime nudge has to be re-scheduled after it or it is silently lost.
 */
export async function syncAllReminders(preferences: UserPreferences): Promise<boolean> {
  const ok = await syncReminders(preferences);
  await scheduleBedtime(preferences);
  return ok;
}

export async function cancelReminders(): Promise<void> {
  if (!remindersSupported) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** How many reminders are actually queued — surfaced in Settings. */
export async function scheduledCount(): Promise<number> {
  if (!remindersSupported) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.length;
}
