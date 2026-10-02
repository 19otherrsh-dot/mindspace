import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { InstructorDetail } from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import {
  Artwork,
  Card,
  Divider,
  ErrorState,
  IconButton,
  Loading,
  ProBadge,
  Screen,
  Txt,
} from '@/components/ui';
import { SessionRow } from '@/components/session-card';

/**
 * Teacher page (competitor gap: Calm leads with the narrator and lets you
 * browse everything they read). Every session already carried an instructor;
 * this makes that a place you can go.
 */
export default function TeacherScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const { data, error, loading, refetch } = useQuery<InstructorDetail>(
    (signal) => api.get<InstructorDetail>(`/content/teachers/${slug}`, signal),
    [slug],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  const hours = Math.floor((data.totalMinutes ?? 0) / 60);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <Artwork title={data.name} category="beginners" height={220} rounded={0}>
          <View style={{ padding: spacing.xl, gap: spacing.xs, backgroundColor: 'rgba(6,9,22,0.4)' }}>
            {data.tagline ? (
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {data.tagline.toUpperCase()}
              </Txt>
            ) : null}
            <Txt variant="display" style={{ color: '#FFF' }}>
              {data.name}
            </Txt>
          </View>
        </Artwork>

        <View style={{ padding: spacing.xl, gap: spacing.xl }}>
          <Card>
            <View style={{ flexDirection: 'row' }}>
              {[
                { value: String(data.sessionCount ?? 0), label: 'SESSIONS' },
                { value: String(data.courseCount ?? 0), label: 'COURSES' },
                {
                  value: hours > 0 ? `${hours}h` : `${data.totalMinutes ?? 0}m`,
                  label: 'OF AUDIO',
                },
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

          <Txt variant="body" tone="muted">
            {data.bio}
          </Txt>

          {data.courses.length > 0 ? (
            <View style={{ gap: spacing.md }}>
              <Txt variant="heading">Courses</Txt>
              {data.courses.map((course) => (
                <Pressable
                  key={course.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/course/${course.slug}`)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                    <Artwork title={course.title} category="beginners" size={56} rounded={radius.md} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {course.title}
                        </Txt>
                        {course.isPro ? <ProBadge /> : null}
                      </View>
                      <Txt variant="caption" tone="faint">
                        {course.totalDays} days
                      </Txt>
                    </View>
                    <Txt tone="faint">›</Txt>
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Divider />

        <View style={{ paddingTop: spacing.lg, gap: spacing.sm }}>
          <Txt variant="heading" style={{ paddingHorizontal: spacing.xl }}>
            Sessions
          </Txt>
          {data.sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
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
