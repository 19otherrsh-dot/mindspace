import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FIRST_TEN_DAYS, formatDuration } from '@mindspace/shared';
import { categoryColors, radius, spacing } from '@/theme';
import * as haptics from '@/lib/haptics';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { Button, Card, Txt } from '@/components/ui';
import { usePlayerStore } from '@/store/player';
import AppleHealthKit, { HealthKitPermissions } from 'react-native-health';

/** Screen 11 — celebrates the finished session and prompts the post-mood check-in. */
export default function Summary() {
  const router = useRouter();
  const result = usePlayerStore((s) => s.lastResult);
  const clearResult = usePlayerStore((s) => s.clearResult);

  const reducedMotion = useReducedMotion();
  const reachedTen = result?.reachedFirstTenDays ?? false;

  const glow = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(24)).current;

  // One value per pip, lit in sequence so the ten days land one at a time.
  const pipValues = useRef(
    Array.from({ length: FIRST_TEN_DAYS }, () => new Animated.Value(0.25)),
  ).current;
  const pipOpacities = pipValues;

  /*
   * Acknowledge arriving here, once, at the weight the moment deserves: a
   * milestone or a new badge gets applause, an ordinary finished sit gets a
   * quiet confirmation. Silence would be the wrong answer to either.
   */
  const acknowledged = useRef(false);
  useEffect(() => {
    if (!result || acknowledged.current) return;
    acknowledged.current = true;

    if (reachedTen || result.newAchievements.length > 0) haptics.milestone();
    else haptics.complete();
  }, [result, reachedTen]);

  useEffect(() => {
    if (!reachedTen) return;

    if (reducedMotion) {
      // Still arrive, just without the travel.
      pipValues.forEach((value) => value.setValue(1));
      return;
    }

    Animated.stagger(
      90,
      pipValues.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [reachedTen, reducedMotion, pipValues]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(glow, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Log this session to HealthKit on iOS. Note `secondsListened`, not
    // `totalMinutes` — the latter is the user's all-time total, which would
    // write one enormous mindful session to Health after every sitting.
    if (Platform.OS === 'ios' && result?.completion.secondsListened) {
      const permissions = {
        permissions: {
          read: [AppleHealthKit.Constants.Permissions.MindfulSession],
          write: [AppleHealthKit.Constants.Permissions.MindfulSession],
        },
      } as HealthKitPermissions;

      AppleHealthKit.initHealthKit(permissions, (err: string) => {
        if (err) return;
        
        const endDate = new Date();
        const startDate = new Date(
          endDate.getTime() - result.completion.secondsListened * 1000,
        );
        
        AppleHealthKit.saveMindfulSession({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        } as any, () => {});
      });
    }
  }, [glow, rise, result]);

  if (!result) {
    // Landed here without a completed session (a refresh, or a deep link).
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1026' }}>
        <Button title="Back to Mindspace" fullWidth={false} onPress={() => router.replace('/(tabs)')} />
      </View>
    );
  }

  // Pulled out here so the callbacks below close over narrowed values rather
  // than re-reading a nullable store field.
  const { session, streak, totalMinutes } = result;
  const [from, to] = categoryColors[session.category];

  function leave(destination: '/(tabs)' | 'another') {
    clearResult();
    if (destination === 'another') router.replace('/(tabs)/explore');
    else router.replace('/(tabs)');
  }

  function checkInMood() {
    clearResult();
    // Replace rather than push, so Back does not return to the summary.
    router.replace({
      pathname: '/mood',
      params: { context: 'post_session', sessionId: session.id, next: '/(tabs)' },
    });
  }

  async function share() {
    try {
      await Share.share({
        message:
          `I just finished "${session.title}" on Mindspace — ` +
          `${streak} day streak and ${totalMinutes} minutes of practice.`,
      });
    } catch {
      /* the user dismissed the sheet */
    }
  }

  return (
    <LinearGradient colors={[from, to, '#0B1026']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Animated.View
          style={{
            flex: 1,
            padding: spacing.xl,
            gap: spacing.xl,
            opacity: glow,
            transform: [{ translateY: rise }],
          }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}>
            <Animated.View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
              }}>
              <Txt style={{ fontSize: 52 }}>{reachedTen ? '🌳' : '✨'}</Txt>
            </Animated.View>

            <Txt variant="display" style={{ color: '#FFF', textAlign: 'center' }}>
              {reachedTen ? 'Ten days' : 'Well done'}
            </Txt>
            <Txt
              variant="body"
              style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
              {reachedTen
                ? 'This is the point where it usually starts to stick. You built that.'
                : `You finished ${session.title}`}
            </Txt>

            {/*
              Ten filled pips, the same shape the Home card counted up with, so
              the milestone reads as the end of something the user watched fill
              rather than a badge appearing from nowhere.
            */}
            {reachedTen ? (
              <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.xl }}>
                {Array.from({ length: FIRST_TEN_DAYS }, (_, i) => (
                  <Animated.View
                    key={i}
                    style={{
                      width: 18,
                      height: 6,
                      borderRadius: radius.pill,
                      backgroundColor: '#FFF',
                      opacity: pipOpacities[i],
                    }}
                  />
                ))}
              </View>
            ) : null}

            {result.streakIncreased ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.pill,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}>
                <Txt style={{ fontSize: 18 }}>🔥</Txt>
                <Txt variant="bodyStrong" style={{ color: '#FFF' }}>
                  {result.streak} day streak
                </Txt>
              </View>
            ) : null}

            {/*
              Returning after a missed day is the moment people assume the
              streak is gone and stop coming back. Say plainly that it held —
              and frame the day off as rest, not as a failure that was excused.
            */}
            {result.streakProtectedDate ? (
              <View
                style={{
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderRadius: radius.lg,
                  backgroundColor: 'rgba(255,255,255,0.12)',
                }}>
                <Txt variant="bodyStrong" style={{ color: '#FFF', textAlign: 'center' }}>
                  🛡️ Your streak held
                </Txt>
                <Txt
                  variant="caption"
                  style={{ color: 'rgba(255,255,255,0.82)', textAlign: 'center' }}>
                  You took a rest day, and it kept your {result.streak} days going.
                  {result.restDaysRemaining > 0
                    ? ` ${result.restDaysRemaining} more left this month.`
                    : ' That was your last one this month.'}
                </Txt>
              </View>
            ) : null}
          </View>

          {/* Stats */}
          <Card style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'transparent' }}>
            <View style={{ flexDirection: 'row' }}>
              {[
                { label: 'THIS SESSION', value: formatDuration(result.completion.secondsListened) },
                { label: 'THIS WEEK', value: `${result.minutesThisWeek} min` },
                { label: 'ALL TIME', value: `${result.totalMinutes} min` },
              ].map((stat) => (
                <View key={stat.label} style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
                  <Txt variant="heading" style={{ color: '#FFF' }}>
                    {stat.value}
                  </Txt>
                  <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {stat.label}
                  </Txt>
                </View>
              ))}
            </View>
          </Card>

          {/* Newly unlocked badges */}
          {result.newAchievements.length > 0 ? (
            <Card style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'transparent', gap: spacing.md }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {result.newAchievements.length === 1 ? 'NEW ACHIEVEMENT' : 'NEW ACHIEVEMENTS'}
              </Txt>
              {result.newAchievements.map((achievement) => (
                <View
                  key={achievement.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Txt style={{ fontSize: 24 }}>🏅</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong" style={{ color: '#FFF' }}>
                      {achievement.title}
                    </Txt>
                    <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
                      {achievement.description}
                    </Txt>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          {result.courseCompleted ? (
            <Card style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'transparent' }}>
              <Txt variant="bodyStrong" style={{ color: '#FFF' }}>
                🎓 Course complete
              </Txt>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Your certificate is on the course page.
              </Txt>
            </Card>
          ) : null}

          {/* Actions */}
          <View style={{ gap: spacing.md }}>
            <Button title="How do you feel now?" variant="onColor" onPress={checkInMood} />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button
                title="Play another"
                variant="onColorSubtle"
                style={{ flex: 1 }}
                onPress={() => leave('another')}
              />
              <Button
                title="Done"
                variant="onColorSubtle"
                style={{ flex: 1 }}
                onPress={() => leave('/(tabs)')}
              />
            </View>
            <Button title="Share" variant="onColorSubtle" onPress={share} />
          </View>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}
