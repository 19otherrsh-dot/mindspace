import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Course } from '@mindspace/shared';
import { api, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import {
  Artwork,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  ProBadge,
  Screen,
  Txt,
} from '@/components/ui';

type Filter = 'all' | 'in_progress' | 'completed';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
];

/** Progress bar shown on any course the user has started. */
function CourseProgress({ course }: { course: Course }) {
  const theme = useTheme();
  const completed = course.enrollment?.daysCompleted ?? 0;
  const ratio = course.totalDays > 0 ? completed / course.totalDays : 0;

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          height: 5,
          borderRadius: 3,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: 'hidden',
        }}>
        <View
          style={{
            height: '100%',
            width: `${ratio * 100}%`,
            borderRadius: 3,
            backgroundColor: course.enrollment?.completedAt ? theme.colors.success : theme.colors.accent,
          }}
        />
      </View>
      <Txt variant="micro" tone="faint">
        {course.enrollment?.completedAt
          ? 'COMPLETED'
          : `DAY ${completed} OF ${course.totalDays}`}
      </Txt>
    </View>
  );
}

function CourseCard({ course, onPress }: { course: Course; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${course.title}, ${course.totalDays} days`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Card style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
        <Artwork title={course.title} category="beginners" size={72} rounded={radius.md} />

        <View style={{ flex: 1, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Txt variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {course.title}
            </Txt>
            {course.isPro ? <ProBadge /> : null}
          </View>

          <Txt variant="caption" tone="faint" numberOfLines={1}>
            {course.totalDays} days
            {course.instructor ? ` · ${course.instructor.name}` : ''}
            {course.ratingCount > 0 ? ` · ★ ${course.rating.toFixed(1)}` : ''}
          </Txt>

          {course.enrollment ? <CourseProgress course={course} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

/** Screen 12 — the Courses hub. */
export default function Courses() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, error, loading, refreshing, refetch } = useQuery<{ items: Course[] }>(
    (signal) => api.get<{ items: Course[] }>(`/courses${qs({ filter })}`, signal),
    [filter],
  );

  // Enrolment progress changes elsewhere in the app (the player), so refresh
  // whenever this tab comes back into view.
  useFocusEffect(
    useCallback(() => {
      void refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filter]),
  );

  const courses = data?.items ?? [];
  const inProgress = courses.filter((c) => c.enrollment && !c.enrollment.completedAt);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} />}>
          <View style={{ gap: spacing.sm }}>
            <Txt variant="display">Courses</Txt>
            <Txt variant="body" tone="muted">
              Multi-day programs that build one session at a time.
            </Txt>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {FILTERS.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={filter === option.id}
                onPress={() => setFilter(option.id)}
              />
            ))}
          </View>

          {/* Resume banner for whatever is currently underway */}
          {filter === 'all' && inProgress.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/course/${inProgress[0]!.slug}`)}>
              <Artwork title={inProgress[0]!.title} category="beginners" height={160} rounded={radius.xl}>
                <View style={{ padding: spacing.xl, gap: spacing.xs, backgroundColor: 'rgba(6,9,22,0.35)' }}>
                  <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    PICK UP WHERE YOU LEFT OFF
                  </Txt>
                  <Txt variant="title" style={{ color: '#FFF' }} numberOfLines={1}>
                    {inProgress[0]!.title}
                  </Txt>
                  <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    Day {inProgress[0]!.enrollment?.nextDayNumber} of {inProgress[0]!.totalDays}
                  </Txt>
                </View>
              </Artwork>
            </Pressable>
          ) : null}

          {courses.length === 0 ? (
            <EmptyState
              glyph={filter === 'completed' ? '🏅' : '🧭'}
              title={filter === 'completed' ? 'No finished courses — yet' : 'Nothing on the go'}
              message={
                filter === 'completed'
                  ? 'Finish one and it lands here with its certificate. The Basics course is ten days.'
                  : 'Pick a course and it will keep your place, one day at a time.'
              }
              action={{ label: 'Browse all courses', onPress: () => setFilter('all') }}
            />
          ) : (
            <View style={{ gap: spacing.md }}>
              {courses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onPress={() => router.push(`/course/${course.slug}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
