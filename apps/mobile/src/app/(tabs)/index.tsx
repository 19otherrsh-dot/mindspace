import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import { Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';
import type { HomeFeed, Session } from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { syncWidget } from '@/lib/widget';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import {
  Card,
  ErrorState,
  HScroll,
  Loading,
  Row,
  Screen,
  Txt,
} from '@/components/ui';
import { HeroCard, SessionCard } from '@/components/session-card';
import { FirstTenDays } from '@/components/first-ten-days';
import {
  GettingStarted,
  ToolsRow,
  useGettingStarted,
} from '@/components/getting-started';
import { useAuthStore, useHasPro } from '@/store/auth';
import { usePlayerStore } from '@/store/player';

/** Screen 5 — the Today feed, and the app's default landing screen. */
export default function Home() {
  const router = useRouter();
  const theme = useTheme();
  const hasPro = useHasPro();
  const play = usePlayerStore((s) => s.play);
  const user = useAuthStore((s) => s.user);

  const { data, error, loading, refreshing, refetch } = useQuery<HomeFeed>(
    (signal) => api.get<HomeFeed>('/home', signal),
    [user?.id],
  );

  // The feed embeds the streak and mood state, both of which change when the
  // user finishes a session, so re-read it whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      void refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // The home-screen widget shows the streak, and this is the only place it is
  // fetched, so publish it whenever the feed changes.
  useEffect(() => {
    if (data) syncWidget(data.streak);
  }, [data?.streak]);

  // Immersive Ambient Sound (Calm style)
  const playAmbient = user?.preferences?.backgroundSoundEnabled ?? true;
  const ambientPlayer = useAudioPlayer('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3');
  
  useEffect(() => {
    if (!ambientPlayer) return;
    if (playAmbient) {
      ambientPlayer.loop = true;
      ambientPlayer.volume = 0.2;
      ambientPlayer.play();
    } else {
      ambientPlayer.pause();
    }
  }, [playAmbient, ambientPlayer]);

  // Dynamic Background Animation
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  const openSession = (session: Session) => {
    if (session.isPro && !hasPro) {
      router.push('/paywall');
      return;
    }
    play(session);
    router.push('/player');
  };

  // Must run before the early returns below — it is a hook, and it tolerates
  // a null feed while the first fetch is in flight.
  const startTasks = useGettingStarted(data);

  if (loading && !data) return <Loading label="Gathering your day" />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <Screen>
      <Animated.View
        style={{
          position: 'absolute',
          top: -200,
          left: -100,
          right: -100,
          height: 500,
          backgroundColor: 'rgba(91, 127, 255, 0.15)',
          borderRadius: 400,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] }) },
          ],
        }}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxxl, gap: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }>
          {/* Greeting + streak */}
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.lg,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.lg,
            }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="caption" tone="faint">
                {data.greeting}
              </Txt>
              <Txt variant="title">{data.displayName}</Txt>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Current streak: ${data.streak} days`}
              onPress={() => router.push('/(tabs)/stats')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.surfaceMuted,
              }}>
              <Txt style={{ fontSize: 16 }}>🔥</Txt>
              <Txt variant="bodyStrong" style={{ color: theme.colors.streak }}>
                {data.streak}
              </Txt>
            </Pressable>
          </View>

          {/* Mood check-in prompt, only while today has no reading */}
          {data.needsMoodCheckIn ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/mood')}
              style={{ paddingHorizontal: spacing.xl }}>
              <Card
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.lg,
                  backgroundColor: theme.colors.surfaceMuted,
                }}>
                <Txt style={{ fontSize: 28 }}>💭</Txt>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong">How are you feeling?</Txt>
                  <Txt variant="caption" tone="faint">
                    A quick check-in shapes what we suggest today
                  </Txt>
                </View>
                <Txt variant="heading" tone="faint">
                  ›
                </Txt>
              </Card>
            </Pressable>
          ) : null}

          {/* Daily recommendation */}
          <View style={{ paddingHorizontal: spacing.xl }}>
            <HeroCard
              session={data.daily}
              reason={data.dailyReason}
              onPress={() => openSession(data.daily)}
            />
          </View>

          {/* The first ten days, while they are still ahead of the user */}
          <FirstTenDays completed={data.practiceDays} />

          {/* Tools that need no content: a silent timer and breathing */}
          <ToolsRow />

          {/* Optional, self-paced — disappears once it is finished */}
          <GettingStarted tasks={startTasks} />

          {/* In-progress course */}
          {data.continueCourse ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/course/${data.continueCourse!.slug}`)}
              style={{ paddingHorizontal: spacing.xl }}>
              <Card style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="micro" tone="accent">
                      CONTINUE YOUR COURSE
                    </Txt>
                    <Txt variant="subheading">{data.continueCourse.title}</Txt>
                  </View>
                  <Txt variant="caption" tone="faint">
                    Day {data.continueCourse.enrollment?.nextDayNumber ?? 1} of{' '}
                    {data.continueCourse.totalDays}
                  </Txt>
                </View>

                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.colors.surfaceMuted,
                    overflow: 'hidden',
                  }}>
                  <View
                    style={{
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: theme.colors.accent,
                      width: `${
                        ((data.continueCourse.enrollment?.daysCompleted ?? 0) /
                          data.continueCourse.totalDays) *
                        100
                      }%`,
                    }}
                  />
                </View>
              </Card>
            </Pressable>
          ) : null}

          {/* Feed sections */}
          {data.sections.map((section) => (
            <Row key={section.id} title={section.title} subtitle={section.subtitle}>
              {section.layout === 'grid' ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: spacing.md,
                    paddingHorizontal: spacing.xl,
                  }}>
                  {section.sessions.slice(0, 4).map((session) => (
                    <SessionCard key={session.id} session={session} width={164} />
                  ))}
                </View>
              ) : (
                <HScroll>
                  {section.sessions.map((session) => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                </HScroll>
              )}
            </Row>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
