import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Achievement, StatsSummary } from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Card, Chip, ErrorState, Loading, Screen, Txt } from '@/components/ui';
import { CalendarHeatmap, MoodTrend, WeeklyBars } from '@/components/charts';

/** A single headline number in the top row. */
function Stat({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
      <Txt variant="title" style={accent ? { color: accent } : undefined}>
        {value}
      </Txt>
      <Txt variant="micro" tone="faint" style={{ textAlign: 'center' }}>
        {label}
      </Txt>
    </View>
  );
}

function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const theme = useTheme();
  const unlocked = achievement.unlockedAt !== null;
  const ratio = achievement.threshold > 0 ? achievement.progress / achievement.threshold : 0;

  return (
    <View
      accessibilityLabel={`${achievement.title}: ${
        unlocked ? 'unlocked' : `${achievement.progress} of ${achievement.threshold}`
      }`}
      style={{
        width: '31%',
        alignItems: 'center',
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: unlocked ? theme.colors.surface : 'transparent',
        opacity: unlocked ? 1 : 0.55,
      }}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: unlocked ? theme.colors.accent : theme.colors.surfaceMuted,
        }}>
        <Txt style={{ fontSize: 22 }}>{unlocked ? '🏅' : '🔒'}</Txt>
      </View>

      <Txt variant="micro" style={{ textAlign: 'center' }} numberOfLines={2}>
        {achievement.title}
      </Txt>

      {/* Locked badges show how far along the user is, not just that they're locked. */}
      {!unlocked ? (
        <View
          style={{
            width: '100%',
            height: 3,
            borderRadius: 2,
            backgroundColor: theme.colors.surfaceMuted,
            overflow: 'hidden',
          }}>
          <View
            style={{
              height: '100%',
              width: `${Math.min(1, ratio) * 100}%`,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Screen 14 — the personal progress hub. */
export default function Stats() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [moodRange, setMoodRange] = useState<'7d' | '30d'>('7d');

  const { data, error, loading, refreshing, refetch } = useQuery<StatsSummary>(
    (signal) => api.get<StatsSummary>('/stats', signal),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (loading && !data) return <Loading label="Adding up your practice" />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  const hours = Math.floor(data.totalMinutes / 60);
  const chartWidth = width - spacing.xl * 2 - spacing.lg * 2;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}>
          <Txt variant="display">Your practice</Txt>

          {/* Streak hero */}
          <Card style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl }}>
            <Txt style={{ fontSize: 40 }}>{data.streakActiveToday ? '🔥' : '🕯️'}</Txt>
            <Txt style={{ fontSize: 56, fontWeight: '700', color: theme.colors.streak, letterSpacing: -2 }}>
              {data.currentStreak}
            </Txt>
            <Txt variant="caption" tone="muted">
              day streak
            </Txt>
            <Txt variant="micro" tone="faint">
              {data.streakActiveToday
                ? "TODAY IS DONE — SEE YOU TOMORROW"
                : data.currentStreak > 0
                  ? 'MEDITATE TODAY TO KEEP IT ALIVE'
                  : 'START ONE TODAY'}
            </Txt>
            {data.longestStreak > data.currentStreak ? (
              <Txt variant="micro" tone="faint">
                YOUR BEST IS {data.longestStreak} DAYS
              </Txt>
            ) : null}

            {/*
              Shown before it is needed. A streak people believe is fragile is
              one they abandon after a single missed day; saying up front that
              a rest day is banked is what takes the fear out of it.
            */}
            {data.currentStreak > 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  marginTop: spacing.xs,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.pill,
                  backgroundColor: theme.colors.surfaceMuted,
                }}>
                <Txt style={{ fontSize: 13 }}>{data.restDaysRemaining > 0 ? '🛡️' : '○'}</Txt>
                <Txt variant="micro" tone="muted">
                  {data.restDaysRemaining > 0
                    ? `${data.restDaysRemaining} REST ${
                        data.restDaysRemaining === 1 ? 'DAY' : 'DAYS'
                      } LEFT — MISS ONE AND YOUR STREAK HOLDS`
                    : 'NO REST DAYS LEFT THIS MONTH'}
                </Txt>
              </View>
            ) : null}
          </Card>

          {/* Totals */}
          <Card>
            <View style={{ flexDirection: 'row' }}>
              <Stat
                value={hours > 0 ? `${hours}h` : `${data.totalMinutes}m`}
                label="TOTAL TIME"
              />
              <Stat value={String(data.totalSessions)} label="SESSIONS" />
              <Stat value={`${data.minutesThisWeek}m`} label="THIS WEEK" />
            </View>
          </Card>

          {/* Weekly bars */}
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <Txt variant="heading">This week</Txt>
              <Txt variant="caption" tone="faint">
                {data.sessionsThisWeek} session{data.sessionsThisWeek === 1 ? '' : 's'},{' '}
                {data.minutesThisWeek} minutes
              </Txt>
            </View>
            <WeeklyBars data={data.weeklyActivity} />
          </Card>

          {/* Mood trend */}
          <Card style={{ gap: spacing.lg }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.md,
              }}>
              <Txt variant="heading">Mood</Txt>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Chip label="7 days" selected={moodRange === '7d'} onPress={() => setMoodRange('7d')} />
                <Chip label="30 days" selected={moodRange === '30d'} onPress={() => setMoodRange('30d')} />
              </View>
            </View>

            <MoodTrend
              data={moodRange === '7d' ? data.moodTrend7d : data.moodTrend30d}
              width={chartWidth}
            />
          </Card>

          {/* Heatmap */}
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <Txt variant="heading">Consistency</Txt>
              <Txt variant="caption" tone="faint">
                Every day you practised in the last six months
              </Txt>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <CalendarHeatmap data={data.heatmap} />
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Txt variant="micro" tone="faint">
                LESS
              </Txt>
              {[0, 0.35, 0.6, 0.85, 1].map((opacity) => (
                <View
                  key={opacity}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2.5,
                    backgroundColor: opacity === 0 ? theme.colors.surfaceMuted : theme.colors.accent,
                    opacity: opacity === 0 ? 1 : opacity,
                  }}
                />
              ))}
              <Txt variant="micro" tone="faint">
                MORE
              </Txt>
            </View>
          </Card>

          {/* Achievements */}
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <Txt variant="heading">Achievements</Txt>
              <Txt variant="caption" tone="faint">
                {data.achievements.filter((a) => a.unlockedAt).length} of {data.achievements.length}{' '}
                unlocked
              </Txt>
            </View>

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
                justifyContent: 'flex-start',
              }}>
              {data.achievements.map((achievement) => (
                <AchievementBadge key={achievement.id} achievement={achievement} />
              ))}
            </View>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
