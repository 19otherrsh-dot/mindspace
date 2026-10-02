import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import {
  TIMER_DURATIONS,
  unguidedSlug,
  type CompleteSessionResponse,
  type Paginated,
  type Session,
} from '@mindspace/shared';
import { api, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { Button, IconButton, Txt } from '@/components/ui';
import { ProgressRing } from '@/components/charts';
import { usePlayerStore } from '@/store/player';

/**
 * Unguided timer (competitor gap: Calm ships a plain timer with interval
 * bells; Mindspace had no way to sit without a narrator).
 *
 * It records against a seeded `unguided` session, so a silent sit counts
 * toward the streak, the heatmap and achievements exactly like a guided one.
 */

const INTERVALS = [
  { minutes: 0, label: 'None' },
  { minutes: 1, label: 'Every 1 min' },
  { minutes: 2, label: 'Every 2 min' },
  { minutes: 5, label: 'Every 5 min' },
  { minutes: 10, label: 'Every 10 min' },
] as const;

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function Timer() {
  const router = useRouter();
  const setResult = usePlayerStore((s) => s.setResult);

  const [minutes, setMinutes] = useState<number>(10);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useKeepAwake();

  // The seeded timer sessions are what completions are recorded against.
  const { data: timers } = useQuery<Paginated<Session>>(
    (signal) =>
      api.get<Paginated<Session>>(
        `/content/sessions${qs({ format: 'unguided', limit: 20, sort: 'duration' })}`,
        signal,
      ),
    [],
  );

  const sessionFor = useCallback(
    (mins: number): Session | undefined =>
      timers?.items.find((item) => item.slug === unguidedSlug(mins)),
    [timers],
  );

  const total = minutes * 60;
  const remaining = Math.max(0, total - elapsed);
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  /** A bell is haptic-only: there is no bell audio in the catalogue yet. */
  const ring = useCallback(() => {
    if (Platform.OS === 'web') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const finish = useCallback(
    async (completed: boolean, seconds: number) => {
      setRunning(false);
      if (saving) return;

      const session = sessionFor(minutes);
      // Under a minute is not a session; drop it rather than polluting stats.
      if (!session || !startedAt || seconds < 60) {
        router.replace('/(tabs)');
        return;
      }

      setSaving(true);
      ring();

      try {
        const result = await api.post<CompleteSessionResponse>('/activity/complete', {
          sessionId: session.id,
          startedAt,
          secondsListened: Math.round(Math.min(seconds, total)),
          finished: completed,
        });
        setResult({ ...result, session });
        router.replace('/summary');
      } catch {
        router.replace('/(tabs)');
      }
    },
    [saving, sessionFor, minutes, startedAt, total, ring, setResult, router],
  );

  // The clock itself.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Interval bells and the closing bell.
  const lastBell = useRef(0);
  useEffect(() => {
    if (!running) return;

    if (elapsed >= total && total > 0) {
      void finish(true, total);
      return;
    }

    if (intervalMinutes > 0 && elapsed > 0) {
      const bellNumber = Math.floor(elapsed / (intervalMinutes * 60));
      if (bellNumber > lastBell.current) {
        lastBell.current = bellNumber;
        ring();
      }
    }
  }, [elapsed, running, total, intervalMinutes, ring, finish]);

  // Slow breathing pulse, matching the guided player's visual language.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, running]);

  function start() {
    lastBell.current = 0;
    setElapsed(0);
    setStartedAt(new Date().toISOString());
    setRunning(true);
    ring();
  }

  return (
    <LinearGradient colors={['#1C2445', '#131A35', '#0B1026']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg }}>
          <IconButton
            glyph="✕"
            label="Close timer"
            tone="onAccent"
            onPress={() => (running ? void finish(false, elapsed) : router.back())}
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {running ? 'Unguided' : 'Unguided timer'}
            </Txt>
          </View>
          <View style={{ width: 44 }} />
        </View>

        {running ? (
          /* ---------------- Running ---------------- */
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl }}>
            <Animated.View
              style={{
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
              }}>
              <ProgressRing progress={progress} size={280} strokeWidth={5}>
                <View 
                  style={{ alignItems: 'center', gap: spacing.xs }}
                  accessible={true}
                  accessibilityRole="timer"
                  accessibilityLabel={`${remaining > 60 ? Math.floor(remaining / 60) + ' minutes and ' : ''}${remaining % 60} seconds remaining`}
                >
                  <Txt style={{ fontSize: 52, fontWeight: '200', color: '#FFF', letterSpacing: -1 }}>
                    {clock(remaining)}
                  </Txt>
                  <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    REMAINING
                  </Txt>
                </View>
              </ProgressRing>
            </Animated.View>

            {intervalMinutes > 0 ? (
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.5)' }}>
                BELL EVERY {intervalMinutes} MIN
              </Txt>
            ) : null}
          </View>
        ) : (
          /* ---------------- Setup ---------------- */
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl, flexGrow: 1 }}>
            <View style={{ gap: spacing.sm }}>
              <Txt variant="display" style={{ color: '#FFF' }}>
                Sit in silence
              </Txt>
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.75)' }}>
                No narration. A bell to begin and end, and interval bells if you want them.
              </Txt>
            </View>

            <View style={{ gap: spacing.md }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.6)' }}>
                HOW LONG
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {TIMER_DURATIONS.map((option) => {
                  const selected = minutes === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${option} minutes`}
                      onPress={() => setMinutes(option)}
                      style={{
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                        borderRadius: radius.pill,
                        backgroundColor: selected ? '#FFF' : 'rgba(255,255,255,0.14)',
                        minWidth: 64,
                        alignItems: 'center',
                      }}>
                      <Txt
                        variant="bodyStrong"
                        style={{ color: selected ? '#131A35' : 'rgba(255,255,255,0.9)' }}>
                        {option}
                      </Txt>
                      <Txt
                        variant="micro"
                        style={{ color: selected ? 'rgba(19,26,53,0.6)' : 'rgba(255,255,255,0.6)' }}>
                        MIN
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: spacing.md }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.6)' }}>
                INTERVAL BELLS
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {INTERVALS.map((option) => {
                  const selected = intervalMinutes === option.minutes;
                  // An interval longer than the sit itself would never ring.
                  const usable = option.minutes === 0 || option.minutes < minutes;
                  if (!usable) return null;

                  return (
                    <Pressable
                      key={option.label}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setIntervalMinutes(option.minutes)}
                      style={{
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.sm + 2,
                        borderRadius: radius.pill,
                        backgroundColor: selected ? '#FFF' : 'rgba(255,255,255,0.14)',
                      }}>
                      <Txt
                        variant="caption"
                        style={{ color: selected ? '#131A35' : 'rgba(255,255,255,0.9)' }}>
                        {option.label}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.md }}>
              <Button
                title={`Begin ${minutes} minutes`}
                variant="onColor"
                onPress={start}
                disabled={!sessionFor(minutes)}
              />
              {!sessionFor(minutes) ? (
                <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
                  LOADING TIMER OPTIONS…
                </Txt>
              ) : (
                <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                  COUNTS TOWARD YOUR STREAK
                </Txt>
              )}
            </View>
          </ScrollView>
        )}

        {running ? (
          <View style={{ padding: spacing.xl, gap: spacing.md }}>
            <Button
              title="End early"
              variant="onColorSubtle"
              loading={saving}
              onPress={() => void finish(false, elapsed)}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </LinearGradient>
  );
}
