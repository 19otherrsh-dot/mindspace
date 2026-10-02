import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, type Course, type CourseDay } from '@mindspace/shared';
import { api } from '@/api/client';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { useQuery } from '@/api/use-query';
import {
  Artwork,
  Button,
  Card,
  Divider,
  ErrorState,
  IconButton,
  Loading,
  ProBadge,
  Screen,
  Txt,
} from '@/components/ui';
import { useHasPro } from '@/store/auth';
import { usePlayerStore } from '@/store/player';

/** One day in the course list, locked until the preceding day is done. */
function DayRow({
  day,
  course,
  onPlay,
}: {
  day: CourseDay;
  course: Course;
  onPlay: (day: CourseDay) => void;
}) {
  const theme = useTheme();
  const disabled = !day.isUnlocked;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`Day ${day.dayNumber}: ${day.title}${disabled ? ', locked' : ''}`}
      disabled={disabled}
      onPress={() => onPlay(day)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingVertical: spacing.md,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}>
      {/* Day marker doubles as the completion indicator */}
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: day.isCompleted ? theme.colors.success : theme.colors.surfaceMuted,
          borderWidth: day.isUnlocked && !day.isCompleted ? 1.5 : 0,
          borderColor: theme.colors.accent,
        }}>
        <Txt variant="caption" style={{ color: day.isCompleted ? '#08221A' : theme.colors.text }}>
          {day.isCompleted ? '✓' : disabled ? '🔒' : day.dayNumber}
        </Txt>
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          Day {day.dayNumber} · {day.title}
        </Txt>
        <Txt variant="caption" tone="faint" numberOfLines={1}>
          {formatDuration(day.session.durationSeconds)}
          {day.session.instructor ? ` · ${day.session.instructor.name}` : ''}
        </Txt>
      </View>

      {!disabled ? <Txt tone="faint">▶</Txt> : null}
      {course.isPro ? null : null}
    </Pressable>
  );
}

/** Screen 13 — course detail with the day-by-day list and progress. */
export default function CourseScreen() {
  const router = useRouter();
  const theme = useTheme();
  const hasPro = useHasPro();
  const play = usePlayerStore((s) => s.play);
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [enrolling, setEnrolling] = useState(false);

  const { data, error, loading, refetch } = useQuery<Course>(
    (signal) => api.get<Course>(`/courses/${slug}`, signal),
    [slug],
  );

  // Finishing a day in the player changes progress; re-read on return.
  useFocusEffect(
    useCallback(() => {
      void refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]),
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  const locked = data.isPro && !hasPro;
  const days = data.days ?? [];
  const completed = data.enrollment?.daysCompleted ?? 0;
  const nextDay = days.find((d) => d.dayNumber === (data.enrollment?.nextDayNumber ?? 1));

  async function enroll() {
    if (locked) {
      router.push('/paywall');
      return;
    }
    setEnrolling(true);
    try {
      await api.post(`/courses/${slug}/enroll`);
      await refetch();
    } finally {
      setEnrolling(false);
    }
  }

  function playDay(day: CourseDay) {
    if (locked) {
      router.push('/paywall');
      return;
    }
    play(day.session, { id: data!.id, dayNumber: day.dayNumber });
    router.push('/player');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <Artwork title={data.title} category="beginners" height={260} rounded={0}>
          <View style={{ padding: spacing.xl, gap: spacing.sm, backgroundColor: 'rgba(6,9,22,0.35)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {data.totalDays} DAY COURSE
              </Txt>
              {data.isPro ? <ProBadge /> : null}
            </View>
            <Txt variant="display" style={{ color: '#FFF' }}>
              {data.title}
            </Txt>
          </View>
        </Artwork>

        <View style={{ padding: spacing.xl, gap: spacing.xl }}>
          <Txt variant="body" tone="muted">
            {data.description}
          </Txt>

          {/* Progress */}
          {data.enrollment ? (
            <Card style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="bodyStrong">
                  {data.enrollment.completedAt ? 'Course complete' : 'Your progress'}
                </Txt>
                <Txt variant="caption" tone="faint">
                  {completed} of {data.totalDays} days
                </Txt>
              </View>

              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.surfaceMuted,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    height: '100%',
                    width: `${(completed / data.totalDays) * 100}%`,
                    borderRadius: 4,
                    backgroundColor: data.enrollment.completedAt
                      ? theme.colors.success
                      : theme.colors.accent,
                  }}
                />
              </View>

              {data.enrollment.certificateUrl ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                  }}>
                  <Txt style={{ fontSize: 22 }}>🎓</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">Certificate earned</Txt>
                    <Txt variant="caption" tone="faint">
                      Completed {new Date(data.enrollment.completedAt!).toLocaleDateString()}
                    </Txt>
                  </View>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Primary action */}
          {locked ? (
            <Button title="Unlock with Pro" icon="🔒" onPress={() => router.push('/paywall')} />
          ) : !data.enrollment ? (
            <Button title="Start this course" loading={enrolling} onPress={enroll} />
          ) : data.enrollment.completedAt ? (
            <Button
              title="Play again from day 1"
              variant="secondary"
              onPress={() => days[0] && playDay(days[0])}
            />
          ) : (
            <Button
              title={`Resume — Day ${data.enrollment.nextDayNumber}`}
              onPress={() => nextDay && playDay(nextDay)}
            />
          )}

          {/* Instructor */}
          {data.instructor ? (
            <View style={{ gap: spacing.sm }}>
              <Txt variant="heading">Your teacher</Txt>
              <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: theme.colors.surfaceMuted,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Txt variant="subheading">{data.instructor.name.charAt(0)}</Txt>
                </View>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {data.instructor.name}
                </Txt>
              </View>
              <Txt variant="body" tone="muted">
                {data.instructor.bio}
              </Txt>
            </View>
          ) : null}

          <Divider />

          {/* Day list */}
          <View style={{ gap: spacing.xs }}>
            <Txt variant="heading">Sessions</Txt>
            {days.map((day) => (
              <DayRow key={day.dayNumber} day={day} course={data} onPlay={playDay} />
            ))}
          </View>
        </View>
      </ScrollView>

      <SafeAreaView style={{ position: 'absolute', top: 0, left: 0 }} edges={['top']}>
        <View style={{ padding: spacing.lg }}>
          <IconButton glyph="‹" label="Go back" tone="onAccent" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
