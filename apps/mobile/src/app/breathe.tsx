import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { Button, IconButton, Txt } from '@/components/ui';
import { radius, spacing } from '@/theme';

/**
 * Breathing exercises (competitor gap: Headspace opens with a breathing
 * exercise during sign-up, before asking for anything).
 *
 * Four patterns rather than one, because the right pattern depends on what you
 * want: a long exhale settles, an even box steadies, a short exhale wakes up.
 */

interface Phase {
  label: string;
  seconds: number;
  /** Where the circle should be at the end of this phase. */
  scale: number;
}

interface Pattern {
  id: string;
  name: string;
  purpose: string;
  colors: readonly [string, string, string];
  phases: Phase[];
}

const PATTERNS: Pattern[] = [
  {
    id: '478',
    name: '4-7-8',
    purpose: 'To fall asleep',
    colors: ['#3B3F8F', '#1E2154', '#0B1026'],
    // A long exhale is the part that down-regulates; the hold makes it possible.
    phases: [
      { label: 'Breathe in', seconds: 4, scale: 2.4 },
      { label: 'Hold', seconds: 7, scale: 2.4 },
      { label: 'Breathe out', seconds: 8, scale: 1 },
    ],
  },
  {
    id: 'box',
    name: 'Box',
    purpose: 'To steady yourself',
    colors: ['#4FA3D1', '#2F6E92', '#0B1026'],
    phases: [
      { label: 'Breathe in', seconds: 4, scale: 2.4 },
      { label: 'Hold', seconds: 4, scale: 2.4 },
      { label: 'Breathe out', seconds: 4, scale: 1 },
      { label: 'Hold', seconds: 4, scale: 1 },
    ],
  },
  {
    id: 'calm',
    name: 'Calming',
    purpose: 'To take the edge off',
    colors: ['#6C63FF', '#4A43C4', '#0B1026'],
    phases: [
      { label: 'Breathe in', seconds: 4, scale: 2.4 },
      { label: 'Breathe out', seconds: 6, scale: 1 },
    ],
  },
  {
    id: 'energise',
    name: 'Energising',
    purpose: 'To wake up',
    colors: ['#E8833A', '#B85F1F', '#0B1026'],
    phases: [
      { label: 'Breathe in', seconds: 6, scale: 2.4 },
      { label: 'Breathe out', seconds: 2, scale: 1 },
    ],
  },
];

const CYCLE_OPTIONS = [3, 5, 8] as const;

export default function BreatheScreen() {
  const router = useRouter();
  // `?onboarding=1` changes the close action to continue the sign-up flow.
  const params = useLocalSearchParams<{ onboarding?: string; next?: string }>();
  const inOnboarding = params.onboarding === '1';

  const [pattern, setPattern] = useState<Pattern>(PATTERNS[0]!);
  const [targetCycles, setTargetCycles] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [cyclesDone, setCyclesDone] = useState(0);

  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  useKeepAwake();

  const phase = pattern.phases[phaseIndex]!;

  const tap = useCallback(() => {
    if (Platform.OS === 'web') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  /** Drives one phase: animate the circle, count down, then hand to the next. */
  useEffect(() => {
    if (!running) return;

    const current = pattern.phases[phaseIndex]!;
    setSecondsLeft(current.seconds);
    tap();

    const animation = Animated.timing(scale, {
      toValue: current.scale,
      duration: reducedMotion ? 0 : current.seconds * 1000,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();

    const ticker = setInterval(() => {
      setSecondsLeft((value) => (value > 1 ? value - 1 : 0));
    }, 1000);

    const advance = setTimeout(() => {
      const isLastPhase = phaseIndex === pattern.phases.length - 1;

      if (!isLastPhase) {
        setPhaseIndex(phaseIndex + 1);
        return;
      }

      const completed = cyclesDone + 1;
      setCyclesDone(completed);

      if (completed >= targetCycles) {
        setRunning(false);
        setDone(true);
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        setPhaseIndex(0);
      }
    }, current.seconds * 1000);

    return () => {
      clearInterval(ticker);
      clearTimeout(advance);
      animation.stop();
    };
  }, [running, phaseIndex, pattern, cyclesDone, targetCycles, scale, tap]);

  function begin() {
    setPhaseIndex(0);
    setCyclesDone(0);
    setDone(false);
    scale.setValue(1);
    setRunning(true);
  }

  function leave() {
    if (inOnboarding) {
      /*
       * The offer comes after the first practice, never before it — the user
       * has now felt what the app does, which is the only honest moment to
       * ask. `?offer=1` presents Pro as an invitation rather than the locked
       * door they would otherwise meet the first time they touch Pro content.
       */
      router.replace('/paywall?offer=1');
      return;
    }

    /*
     * `?next=` chains this exercise into whatever comes after it — the bedtime
     * nudge uses it to run the Wind Down shape: breathe first, then a sleepcast.
     * Replace rather than push, so Back does not land on a finished exercise.
     */
    if (params.next) {
      router.replace(params.next as Parameters<typeof router.replace>[0]);
      return;
    }

    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  return (
    <LinearGradient colors={pattern.colors} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.lg }}>
          <IconButton
            glyph={inOnboarding ? '›' : '✕'}
            label={inOnboarding ? 'Skip' : 'Close'}
            tone="onAccent"
            onPress={leave}
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            {running ? (
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {cyclesDone + 1} of {targetCycles}
              </Txt>
            ) : null}
          </View>
          <View style={{ width: 44 }} />
        </View>

        {running ? (
          /* ---------------- Breathing ---------------- */
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 260, height: 260, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  transform: [{ scale }],
                }}
              />
              <Animated.View
                style={{
                  position: 'absolute',
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  borderWidth: 1.5,
                  borderColor: 'rgba(255,255,255,0.5)',
                  transform: [{ scale }],
                }}
              />
              <Txt style={{ color: '#FFF', fontSize: 40, fontWeight: '200' }}>{secondsLeft}</Txt>
            </View>

            <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl }}>
              <Txt variant="display" style={{ color: '#FFF' }}>
                {phase.label}
              </Txt>
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Let your shoulders drop.
              </Txt>
            </View>
          </View>
        ) : done ? (
          /* ---------------- Finished ---------------- */
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl }}>
            <Txt style={{ fontSize: 56 }}>🌬️</Txt>
            <Txt variant="display" style={{ color: '#FFF', textAlign: 'center' }}>
              Nicely done
            </Txt>
            <Txt
              variant="body"
              style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
              {targetCycles} rounds of {pattern.name}. Notice how that feels before you move on.
            </Txt>

            <View style={{ gap: spacing.md, alignSelf: 'stretch', marginTop: spacing.xl }}>
              <Button title="Go again" variant="onColor" onPress={begin} />
              <Button
                title={inOnboarding ? 'Continue to Mindspace' : 'Done'}
                variant="onColorSubtle"
                onPress={leave}
              />
            </View>
          </View>
        ) : (
          /* ---------------- Setup ---------------- */
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl, flexGrow: 1 }}>
            <View style={{ gap: spacing.sm }}>
              <Txt variant="display" style={{ color: '#FFF' }}>
                {inOnboarding ? 'Before anything else' : 'Take a breath'}
              </Txt>
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {inOnboarding
                  ? 'One minute of breathing, right now. This is the whole idea, in miniature.'
                  : 'Pick a pattern. The circle grows as you breathe in and shrinks as you breathe out.'}
              </Txt>
            </View>

            <View style={{ gap: spacing.md }}>
              {PATTERNS.map((option) => {
                const selected = pattern.id === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.name}: ${option.purpose}`}
                    onPress={() => setPattern(option)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.lg,
                      padding: spacing.lg,
                      borderRadius: radius.lg,
                      backgroundColor: selected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.14)',
                      borderWidth: 1.5,
                      borderColor: selected ? '#FFF' : 'rgba(255,255,255,0.25)',
                    }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="subheading" style={{ color: selected ? '#131A35' : '#FFF' }}>
                        {option.name}
                      </Txt>
                      <Txt
                        variant="caption"
                        style={{ color: selected ? 'rgba(19,26,53,0.65)' : 'rgba(255,255,255,0.75)' }}>
                        {option.purpose}
                      </Txt>
                    </View>
                    <Txt
                      variant="micro"
                      style={{ color: selected ? 'rgba(19,26,53,0.55)' : 'rgba(255,255,255,0.6)' }}>
                      {option.phases.map((p) => p.seconds).join('-')}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ gap: spacing.md }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.6)' }}>
                HOW MANY ROUNDS
              </Txt>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {CYCLE_OPTIONS.map((count) => {
                  const selected = targetCycles === count;
                  const seconds = count * pattern.phases.reduce((sum, p) => sum + p.seconds, 0);
                  return (
                    <Pressable
                      key={count}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setTargetCycles(count)}
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        paddingVertical: spacing.md,
                        borderRadius: radius.md,
                        backgroundColor: selected ? '#FFF' : 'rgba(255,255,255,0.14)',
                      }}>
                      <Txt variant="bodyStrong" style={{ color: selected ? '#131A35' : '#FFF' }}>
                        {count}
                      </Txt>
                      <Txt
                        variant="micro"
                        style={{ color: selected ? 'rgba(19,26,53,0.6)' : 'rgba(255,255,255,0.6)' }}>
                        ~{Math.round(seconds / 60) || 1} MIN
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <Button title="Start breathing" variant="onColor" onPress={begin} />
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}
