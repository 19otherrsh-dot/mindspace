import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, isPro, type Session } from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  IconButton,
  Loading,
  Screen,
  Txt,
} from '@/components/ui';
import { SessionRow } from '@/components/session-card';
import { DownloadsManager } from '@/components/downloads-manager';
import { useAuthStore } from '@/store/auth';

type Tab = 'activity' | 'favourites' | 'downloads';

interface HistoryItem {
  id: string;
  sessionId: string;
  title: string;
  durationSeconds: number;
  completedAt: string;
  secondsListened: number;
  finished: boolean;
}

/** Screen 15 — profile, stats summary and saved content. */
export default function Profile() {
  const router = useRouter();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<Tab>('activity');

  const { data: history, refetch: refetchHistory, refreshing } = useQuery<{ items: HistoryItem[] }>(
    (signal) => api.get<{ items: HistoryItem[] }>('/activity/history?limit=30', signal),
    [],
  );

  const { data: favourites, refetch: refetchFavourites } = useQuery<{ items: Session[] }>(
    (signal) => api.get<{ items: Session[] }>('/content/favourites', signal),
    [],
    { enabled: tab === 'favourites' },
  );

  // The Downloads tab reads the on-device index rather than the API, so it
  // still works with no connection.

  const { data: stats } = useQuery<{
    currentStreak: number;
    totalSessions: number;
    totalMinutes: number;
  }>((signal) => api.get('/stats', signal), []);

  useFocusEffect(
    useCallback(() => {
      void refetchHistory();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (!user) return <Loading />;

  const pro = isPro(user.subscriptionTier);
  const memberSince = new Date(user.memberSince).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxxl, gap: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchHistory} />}>
          {/* Header */}
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.lg,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: spacing.lg,
            }}>
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                backgroundColor: theme.colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Txt variant="title" tone="onAccent">
                {user.displayName.charAt(0).toUpperCase()}
              </Txt>
            </View>

            <View style={{ flex: 1, gap: spacing.xs }}>
              <Txt variant="title">{user.displayName}</Txt>
              <Txt variant="caption" tone="faint">
                {user.isGuest ? 'Guest account' : `Member since ${memberSince}`}
              </Txt>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <View
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: 3,
                    borderRadius: radius.sm,
                    backgroundColor: pro ? theme.colors.warning : theme.colors.surfaceMuted,
                  }}>
                  <Txt variant="micro" style={{ color: pro ? '#2A1D00' : theme.colors.textMuted }}>
                    {pro ? 'PRO' : 'FREE'}
                  </Txt>
                </View>
              </View>
            </View>

            <IconButton glyph="⚙" label="Settings" onPress={() => router.push('/settings')} />
          </View>

          {/* Guests are prompted to keep their progress before it can be lost. */}
          {user.isGuest ? (
            <View style={{ paddingHorizontal: spacing.xl }}>
              <Card style={{ gap: spacing.md, backgroundColor: theme.colors.surfaceMuted }}>
                <Txt variant="bodyStrong">Save your progress</Txt>
                <Txt variant="caption" tone="muted">
                  You are signed in as a guest. Create an account to keep your streak, stats and
                  downloads if you change device.
                </Txt>
                <Button
                  title="Create an account"
                  size="md"
                  onPress={() => router.push('/(onboarding)/sign-in')}
                />
              </Card>
            </View>
          ) : null}

          {/* Quick stats */}
          <View style={{ paddingHorizontal: spacing.xl }}>
            <Card>
              <View style={{ flexDirection: 'row' }}>
                {[
                  { value: String(stats?.currentStreak ?? 0), label: 'STREAK' },
                  { value: String(stats?.totalSessions ?? 0), label: 'SESSIONS' },
                  { value: `${stats?.totalMinutes ?? 0}`, label: 'MINUTES' },
                ].map((stat) => (
                  <View key={stat.label} style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
                    <Txt variant="heading">{stat.value}</Txt>
                    <Txt variant="micro" tone="faint">
                      {stat.label}
                    </Txt>
                  </View>
                ))}
              </View>
            </Card>
          </View>

          {/* Upsell for free users */}
          {!pro ? (
            <View style={{ paddingHorizontal: spacing.xl }}>
              <Pressable accessibilityRole="button" onPress={() => router.push('/paywall')}>
                <Card style={{ gap: spacing.sm, borderColor: theme.colors.accent }}>
                  <Txt variant="bodyStrong" tone="accent">
                    Unlock everything with Pro
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    500+ sessions, sleepcasts, offline downloads and every course.
                  </Txt>
                </Card>
              </Pressable>
            </View>
          ) : null}

          {/* Tabs */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl }}>
            <Chip label="Activity" selected={tab === 'activity'} onPress={() => setTab('activity')} />
            <Chip label="Favourites" selected={tab === 'favourites'} onPress={() => setTab('favourites')} />
            <Chip label="Downloads" selected={tab === 'downloads'} onPress={() => setTab('downloads')} />
          </View>

          {/* Tab content */}
          {tab === 'activity' ? (
            (history?.items ?? []).length === 0 ? (
              <EmptyState
                glyph="🌱"
                title="Your practice starts here"
                message="Every session you finish is kept, so you can look back on how far you have come."
                action={{ label: 'Find a session', onPress: () => router.push('/(tabs)/explore') }}
              />
            ) : (
              <View>
                {(history?.items ?? []).map((item) => (
                  <View key={item.id}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.lg,
                        paddingHorizontal: spacing.xl,
                        paddingVertical: spacing.md,
                      }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {item.title}
                        </Txt>
                        <Txt variant="caption" tone="faint">
                          {new Date(item.completedAt).toLocaleDateString()} ·{' '}
                          {formatDuration(item.secondsListened)}
                          {item.finished ? '' : ' · ended early'}
                        </Txt>
                      </View>
                      <Txt tone={item.finished ? 'success' : 'faint'}>{item.finished ? '✓' : '◔'}</Txt>
                    </View>
                    <Divider />
                  </View>
                ))}
              </View>
            )
          ) : tab === 'favourites' ? (
            (favourites?.items ?? []).length === 0 ? (
              <EmptyState
                glyph="🤍"
                title="Keep what works"
                message="Tap the heart on any session and it will be waiting here next time you need it."
                action={{ label: 'Browse sessions', onPress: () => router.push('/(tabs)/explore') }}
              />
            ) : (
              <View>
                {(favourites?.items ?? []).map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </View>
            )
          ) : (
            <DownloadsManager />
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
