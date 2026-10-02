import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  isPro,
  PRO_DOWNLOAD_LIMIT,
  type AudioQuality,
  type ThemePreference,
  type VoicePack,
} from '@mindspace/shared';
import { api } from '@/api/client';
import { formatBytes } from '@/offline/audio';
import {
  downloadsSupported,
  useDownloadedBytes,
  useDownloadedIds,
  useDownloadsStore,
} from '@/store/downloads';
import { remindersSupported, syncAllReminders } from '@/notifications/reminders';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, Card, Chip, Divider, IconButton, Loading, Screen, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/auth';

/** Labelled settings row with a control on the right. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingVertical: spacing.md,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{label}</Txt>
        {hint ? (
          <Txt variant="caption" tone="faint">
            {hint}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const REMINDER_TIMES = ['06:30', '07:00', '08:00', '12:30', '18:00', '20:00', '21:30'];
/** Bedtimes only — the wind-down has no reason to fire before the evening. */
const BEDTIMES = ['21:00', '21:30', '22:00', '22:30', '23:00', '23:30'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Screen 16 — the full settings panel. */
export default function Settings() {
  const router = useRouter();
  const theme = useTheme();

  const user = useAuthStore((s) => s.user);
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  const logOut = useAuthStore((s) => s.logOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const [busy, setBusy] = useState(false);
  const [reminderWarning, setReminderWarning] = useState<string | null>(null);

  const downloadedIds = useDownloadedIds();
  const downloadedBytes = useDownloadedBytes();
  const removeAllDownloads = useDownloadsStore((s) => s.removeAll);

  if (!user) return <Loading />;

  const prefs = user.preferences;
  const pro = isPro(user.subscriptionTier);

  /**
   * Every control writes through immediately; there is no Save button.
   * Reminder changes also rewrite the local notification schedule, so the two
   * cannot drift apart.
   */
  const save = (patch: Parameters<typeof updatePreferences>[0]) => {
    void updatePreferences(patch)
      .then(async () => {
        // Bedtime shares the schedule: `syncAllReminders` cancels everything
        // before rebuilding, so a bedtime change has to rewrite both or the
        // practice reminder is silently dropped.
        const touchesReminders =
          'reminderEnabled' in patch ||
          'reminderTime' in patch ||
          'reminderDays' in patch ||
          'reminderMessage' in patch ||
          'bedtimeEnabled' in patch ||
          'bedtimeTime' in patch;
        if (!touchesReminders) return;

        const next = useAuthStore.getState().user?.preferences;
        if (!next) return;

        const scheduled = await syncAllReminders(next);
        // The OS can refuse; saying so beats a reminder that silently never comes.
        if ((next.reminderEnabled || next.bedtimeEnabled) && !scheduled && remindersSupported) {
          setReminderWarning(
            'Notifications are turned off for Mindspace in your device settings, so reminders will not appear.',
          );
        } else {
          setReminderWarning(null);
        }
      })
      .catch(() => {
        Alert.alert('Could not save', 'That change did not stick. Please try again.');
      });
  };

  function toggleDay(day: number) {
    const current = prefs.reminderDays;
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    save({ reminderDays: next });
  }

  function confirmDelete() {
    const message =
      'This permanently deletes your account, your practice history and your mood check-ins. This cannot be undone.';

    const run = async () => {
      setBusy(true);
      try {
        await deleteAccount();
        router.replace('/(onboarding)/welcome');
      } catch {
        Alert.alert('Could not delete account', 'Please try again in a moment.');
      } finally {
        setBusy(false);
      }
    };

    // Alert is a no-op on web, so fall back to confirm() there.
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (globalThis.confirm?.(message)) void run();
      return;
    }

    Alert.alert('Delete account?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  }

  function confirmClearDownloads() {
    const message = `Remove all ${downloadedIds.length} downloaded sessions from this device? They stay in your library and can be downloaded again.`;

    const run = async () => {
      setBusy(true);
      try {
        await removeAllDownloads();
      } finally {
        setBusy(false);
      }
    };

    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (globalThis.confirm?.(message)) void run();
      return;
    }

    Alert.alert('Remove all downloads?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove all', style: 'destructive', onPress: () => void run() },
    ]);
  }

  async function cancelSubscription() {
    setBusy(true);
    try {
      await api.delete('/subscription');
      await useAuthStore.getState().refreshUser();
      Alert.alert('Subscription cancelled', 'You keep Pro access until the end of the paid period.');
    } catch {
      Alert.alert('Could not cancel', 'Please try again, or manage it in the App Store.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
            padding: spacing.lg,
          }}>
          <IconButton glyph="‹" label="Go back" onPress={() => router.back()} />
          <Txt variant="heading">Settings</Txt>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxxl }}>
          {/* Reminders */}
          <Card style={{ gap: spacing.sm }}>
            <Txt variant="heading">Reminders</Txt>

            <SettingRow label="Daily reminder" hint="A nudge at the time that suits you">
              <Switch
                value={prefs.reminderEnabled}
                onValueChange={(value) => save({ reminderEnabled: value })}
                trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceMuted }}
              />
            </SettingRow>

            {reminderWarning ? (
              <Txt variant="caption" tone="danger">
                {reminderWarning}
              </Txt>
            ) : null}

            {!remindersSupported ? (
              <Txt variant="micro" tone="faint">
                REMINDERS NEED THE IOS OR ANDROID APP
              </Txt>
            ) : null}

            {prefs.reminderEnabled ? (
              <>
                <Divider />
                <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
                  <Txt variant="caption" tone="muted">
                    Time
                  </Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {REMINDER_TIMES.map((time) => (
                      <Chip
                        key={time}
                        label={time}
                        selected={prefs.reminderTime === time}
                        onPress={() => save({ reminderTime: time })}
                      />
                    ))}
                  </View>
                </View>

                <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
                  <Txt variant="caption" tone="muted">
                    Days {prefs.reminderDays.length === 0 ? '(every day)' : ''}
                  </Txt>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {WEEKDAYS.map((initial, index) => {
                      const active =
                        prefs.reminderDays.length === 0 || prefs.reminderDays.includes(index);
                      return (
                        <Pressable
                          key={index}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`Toggle day ${index}`}
                          onPress={() => toggleDay(index)}
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 19,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: active ? theme.colors.accent : theme.colors.surfaceMuted,
                          }}>
                          <Txt variant="caption" tone={active ? 'onAccent' : 'muted'}>
                            {initial}
                          </Txt>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}

            <Divider />

            {/*
              A second, separate touchpoint. Bedtime is a different habit from
              the morning sit, and someone who wants one may not want the other
              — so it has its own switch, its own time and its own channel.
            */}
            <SettingRow
              label="Bedtime wind-down"
              hint="Breathing, then something to fall asleep to">
              <Switch
                value={prefs.bedtimeEnabled}
                onValueChange={(value) => save({ bedtimeEnabled: value })}
                trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceMuted }}
              />
            </SettingRow>

            {prefs.bedtimeEnabled ? (
              <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
                <Txt variant="caption" tone="muted">
                  Bedtime
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {BEDTIMES.map((time) => (
                    <Chip
                      key={time}
                      label={time}
                      selected={prefs.bedtimeTime === time}
                      onPress={() => save({ bedtimeTime: time })}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </Card>

          {/* Audio */}
          <Card style={{ gap: spacing.sm }}>
            <Txt variant="heading">Audio</Txt>

            <SettingRow label="Background sound" hint="Mix an ambient layer under guided sessions">
              <Switch
                value={prefs.backgroundSoundEnabled}
                onValueChange={(value) => save({ backgroundSoundEnabled: value })}
                trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceMuted }}
              />
            </SettingRow>

            <Divider />

            <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
              <Txt variant="caption" tone="muted">
                Audio quality
              </Txt>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(['standard', 'high'] as AudioQuality[]).map((quality) => (
                  <Chip
                    key={quality}
                    label={quality === 'standard' ? 'Standard' : 'High'}
                    selected={prefs.audioQuality === quality}
                    onPress={() => save({ audioQuality: quality })}
                  />
                ))}
              </View>
              <Txt variant="micro" tone="faint">
                HIGH USES MORE DATA AND STORAGE
              </Txt>
            </View>

            <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
              <Txt variant="caption" tone="muted">
                Voice
              </Txt>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(['calm', 'warm', 'neutral'] as VoicePack[]).map((voice) => (
                  <Chip
                    key={voice}
                    label={voice[0]!.toUpperCase() + voice.slice(1)}
                    selected={prefs.preferredVoicePack === voice}
                    onPress={() => save({ preferredVoicePack: voice })}
                  />
                ))}
              </View>
            </View>

            <Divider />

            <SettingRow label="Download over cellular" hint="Otherwise downloads wait for Wi-Fi">
              <Switch
                value={prefs.downloadOverCellular}
                onValueChange={(value) => save({ downloadOverCellular: value })}
                trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceMuted }}
              />
            </SettingRow>
          </Card>

          {/* Storage */}
          {downloadsSupported ? (
            <Card style={{ gap: spacing.md }}>
              <Txt variant="heading">Offline storage</Txt>

              <SettingRow
                label={`${downloadedIds.length} of ${PRO_DOWNLOAD_LIMIT} sessions`}
                hint={`${formatBytes(downloadedBytes)} used on this device`}>
                <Button
                  title="Manage"
                  variant="secondary"
                  size="md"
                  fullWidth={false}
                  onPress={() => router.push('/(tabs)/profile')}
                />
              </SettingRow>

              {downloadedIds.length > 0 ? (
                <Button
                  title="Remove all downloads"
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onPress={confirmClearDownloads}
                />
              ) : null}
            </Card>
          ) : null}

          {/* Appearance */}
          <Card style={{ gap: spacing.md }}>
            <Txt variant="heading">Appearance</Txt>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['system', 'light', 'dark'] as ThemePreference[]).map((option) => (
                <Chip
                  key={option}
                  label={option[0]!.toUpperCase() + option.slice(1)}
                  selected={prefs.theme === option}
                  onPress={() => save({ theme: option })}
                />
              ))}
            </View>
          </Card>

          {/* Subscription */}
          <Card style={{ gap: spacing.md }}>
            <Txt variant="heading">Subscription</Txt>
            <Txt variant="body" tone="muted">
              {pro
                ? `You are on ${
                    user.subscriptionTier === 'pro_annual' ? 'Pro Annual' : 'Pro Monthly'
                  }${
                    user.subscriptionRenewsAt
                      ? `, renewing ${new Date(user.subscriptionRenewsAt).toLocaleDateString()}`
                      : ''
                  }.`
                : 'You are on the free plan.'}
            </Txt>

            {user.trialEndsAt && new Date(user.trialEndsAt) > new Date() ? (
              <Txt variant="caption" tone="accent">
                Free trial ends {new Date(user.trialEndsAt).toLocaleDateString()}
              </Txt>
            ) : null}

            {pro ? (
              <Button
                title="Cancel subscription"
                variant="secondary"
                size="md"
                loading={busy}
                onPress={cancelSubscription}
              />
            ) : (
              <Button title="Upgrade to Pro" size="md" onPress={() => router.push('/paywall')} />
            )}
          </Card>

          {/* Account */}
          <Card style={{ gap: spacing.md }}>
            <Txt variant="heading">Account</Txt>
            <Txt variant="caption" tone="faint">
              {user.email ?? 'Guest account — no email attached'}
            </Txt>

            <Button title="Log out" variant="secondary" size="md" onPress={() => void logOut()} />
            <Button
              title="Delete account"
              variant="danger"
              size="md"
              loading={busy}
              onPress={confirmDelete}
            />
            <Txt variant="micro" tone="faint" style={{ textAlign: 'center', lineHeight: 16 }}>
              Deleting removes your mood data immediately, in line with GDPR and CCPA.
            </Txt>
          </Card>

          <View
            style={{
              alignItems: 'center',
              gap: spacing.xs,
              paddingVertical: spacing.lg,
              borderRadius: radius.md,
            }}>
            <Txt variant="micro" tone="faint">
              MINDSPACE 1.0.0
            </Txt>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
