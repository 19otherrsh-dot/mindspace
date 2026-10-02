import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import type { CompleteSessionResponse } from '@mindspace/shared';
import { api } from '@/api/client';
import { categoryColors, radius, spacing } from '@/theme';
import { Button, IconButton, Txt } from '@/components/ui';
import { ProgressRing } from '@/components/charts';
import { Slider } from '@/components/slider';
import { BACKGROUND_SOUNDS, usePlayerStore, type BackgroundSound } from '@/store/player';
import { useDownloadsStore } from '@/store/downloads';
import { playbackUriFor, backgroundPlaybackUriFor } from '@/offline/audio';

function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Cycled by the speed control. 1× first so the default is one tap away. */
const SPEEDS = [1, 1.25, 1.5, 0.75] as const;
type Speed = (typeof SPEEDS)[number];

/** Formats a user expects to fall asleep to, where a sleep timer belongs. */
const SLEEPY_FORMATS = ['sleepcast', 'sleep_music', 'wind_down'];

/** Sleep-timer choices, in minutes. */
const TIMER_CHOICES = [5, 10, 15, 30, 45] as const;

/** Screen 10 — the full-screen, distraction-free player. */
export default function Player() {
  const router = useRouter();

  const current = usePlayerStore((s) => s.current);
  const stop = usePlayerStore((s) => s.stop);
  const setResult = usePlayerStore((s) => s.setResult);
  const backgroundSound = usePlayerStore((s) => s.backgroundSound);
  const setBackgroundSound = usePlayerStore((s) => s.setBackgroundSound);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  // The screen must not dim mid-session (PRD screen 10).
  useKeepAwake();

  const session = current?.session ?? null;

  // A downloaded copy always wins over the network, so a session already on
  // the device plays instantly and works in aeroplane mode.
  const localUri = useDownloadsStore((s) => (session ? s.localUriFor(session.id) : null));
  const playingOffline = localUri !== null;

  const sourceUri = session ? playbackUriFor(session, localUri) : null;
  const player = useAudioPlayer(sourceUri, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  const bgSourceUri = backgroundSound !== 'none' ? backgroundPlaybackUriFor(backgroundSound) : null;
  const bgPlayer = useAudioPlayer(bgSourceUri);

  const [mixerOpen, setMixerOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  /** Minutes chosen for the sleep timer, and the moment it expires. */
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const sleepTimerEndsAt = useRef<number | null>(null);

  /**
   * The seeded catalogue points at a CDN that does not exist in development,
   * so the stream will not load. Rather than dead-ending the whole flow, fall
   * back to a wall-clock timer: the session still runs, still completes, and
   * still records real listening time.
   */
  const streamFailed = Boolean(status.error) || !sourceUri;
  const [elapsedFallback, setElapsedFallback] = useState(0);
  const [fallbackRunning, setFallbackRunning] = useState(true);

  useEffect(() => {
    if (!streamFailed || !fallbackRunning || ended) return;
    const timer = setInterval(() => setElapsedFallback((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [streamFailed, fallbackRunning, ended]);

  const duration = session?.durationSeconds ?? 0;
  const elapsed = streamFailed ? elapsedFallback : status.currentTime;
  const playing = streamFailed ? fallbackRunning : status.playing;
  const remaining = Math.max(0, duration - elapsed);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  // Volume changes apply to the live player, not just the store.
  useEffect(() => {
    if (!streamFailed) player.volume = volume;
    // Ambient loops should sit beneath the vocal bed (approx -6dB per the brief, or slightly lower volume)
    bgPlayer.volume = Math.max(0, volume * 0.5); 
  }, [player, bgPlayer, volume, streamFailed]);

  // Keep background player seamlessly looping and sync its play/pause state
  useEffect(() => {
    bgPlayer.loop = true;
    if (playing && backgroundSound !== 'none' && !ended) {
      bgPlayer.play();
    } else {
      bgPlayer.pause();
    }
  }, [playing, backgroundSound, bgPlayer, ended]);

  // Slow breathing pulse behind the ring, so the screen feels alive without
  // asking for attention.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const finish = useCallback(
    async (finished: boolean) => {
      if (!current || !session || saving) return;
      setSaving(true);
      setEnded(true);

      try {
        if (!streamFailed) player.pause();
      } catch {
        /* the player may already be released */
      }

      try {
        const result = await api.post<CompleteSessionResponse>('/activity/complete', {
          sessionId: session.id,
          startedAt: current.startedAt,
          secondsListened: Math.round(Math.min(elapsed, duration)),
          finished,
          courseId: current.courseId,
          courseDayNumber: current.courseDayNumber,
        });

        setResult({ ...result, session });
        stop();
        router.replace('/summary');
      } catch {
        // A failed write must not trap the user inside the player.
        stop();
        router.replace('/(tabs)');
      }
    },
    [current, session, saving, streamFailed, player, elapsed, duration, setResult, stop, router],
  );

  /*
   * The sleep timer fades out and ends the session.
   *
   * It ends rather than merely pausing so the listening still counts toward
   * the streak — someone who fell asleep to a sleepcast practised, and losing
   * their day to a timer they set themselves would be perverse.
   */
  useEffect(() => {
    if (sleepTimerMinutes === null || ended) return;

    sleepTimerEndsAt.current = Date.now() + sleepTimerMinutes * 60_000;

    const tick = setInterval(() => {
      if (sleepTimerEndsAt.current === null) return;
      if (Date.now() < sleepTimerEndsAt.current) return;

      clearInterval(tick);
      sleepTimerEndsAt.current = null;
      void finish(false);
    }, 1_000);

    return () => clearInterval(tick);
  }, [sleepTimerMinutes, ended, finish]);

  // Auto-complete when the audio reaches the end.
  useEffect(() => {
    if (ended) return;
    const reachedEnd = streamFailed
      ? elapsedFallback >= duration && duration > 0
      : status.didJustFinish;
    if (reachedEnd) void finish(true);
  }, [status.didJustFinish, streamFailed, elapsedFallback, duration, ended, finish]);

  // Start playback as soon as the stream is ready.
  useEffect(() => {
    if (!streamFailed && status.isLoaded && !status.playing && !ended) {
      player.play();
    }
    // Only react to load transitions, not every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isLoaded]);

  if (!session) {
    // Deep-linked straight to /player with nothing queued.
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1026' }}>
        <Button title="Back to Mindspace" fullWidth={false} onPress={() => router.replace('/(tabs)')} />
      </View>
    );
  }

  const [from, to] = categoryColors[session.category];

  function togglePlay() {
    if (streamFailed) {
      setFallbackRunning((running) => !running);
      return;
    }
    if (status.playing) player.pause();
    else player.play();
  }

  function rewind() {
    if (streamFailed) {
      setElapsedFallback((value) => Math.max(0, value - 10));
      return;
    }
    void player.seekTo(Math.max(0, status.currentTime - 10));
  }

  /**
   * Cycles playback speed.
   *
   * As much an accessibility control as a preference: a non-native speaker may
   * need the guidance slower, and someone revisiting a familiar session often
   * wants it faster. Pitch correction keeps the narrator sounding human.
   */
  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    setSpeed(next);
    if (!streamFailed) {
      try {
        player.setPlaybackRate(next, 'high');
      } catch {
        /* rate is best-effort; playback continues at the current speed */
      }
    }
  }

  return (
    <LinearGradient colors={[from, to, '#0B1026']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: spacing.lg,
          }}>
          <IconButton
            glyph="⌄"
            label="Minimise player"
            tone="onAccent"
            onPress={() => {
              // Leaving without finishing still records partial listening.
              void finish(false);
            }}
          />
          <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }} numberOfLines={1}>
              {session.instructor?.name ?? 'Mindspace'}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {/*
              Sleep timer, offered only where it makes sense. On a sleepcast the
              user intends to be asleep before the audio ends, so leaving it
              playing all night drains the battery and wakes them at the end.
            */}
            {SLEEPY_FORMATS.includes(session.format) ? (
              <IconButton
                glyph={sleepTimerMinutes ? '◔' : '☾'}
                label={
                  sleepTimerMinutes
                    ? `Sleep timer, ${sleepTimerMinutes} minutes remaining`
                    : 'Set a sleep timer'
                }
                tone="onAccent"
                onPress={() => setTimerOpen(!timerOpen)}
              />
            ) : null}
            <IconButton
              glyph="≋"
              label="Background sound mixer"
              tone="onAccent"
              onPress={() => setMixerOpen(!mixerOpen)}
            />
          </View>
        </View>

        {/* Ring */}
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

          <View style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xxl }}>
            <Txt variant="title" style={{ color: '#FFF', textAlign: 'center' }}>
              {session.title}
            </Txt>
            {session.subtitle ? (
              <Txt
                variant="body"
                style={{ color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
                {session.subtitle}
              </Txt>
            ) : null}
          </View>

          {streamFailed ? (
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center', paddingHorizontal: spacing.xxl }}>
              STREAMING UNAVAILABLE — RUNNING AS A TIMED SESSION
            </Txt>
          ) : status.isBuffering ? (
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.55)' }}>
              BUFFERING…
            </Txt>
          ) : playingOffline ? (
            // Worth stating plainly: it reassures the user that leaving the
            // house without signal was safe.
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.55)' }}>
              ✓ PLAYING FROM YOUR DEVICE
            </Txt>
          ) : null}

          {sleepTimerMinutes !== null ? (
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.55)' }}>
              ☾ ENDING IN {sleepTimerMinutes} MINUTES
            </Txt>
          ) : null}
        </View>

        {/* Sleep timer */}
        {timerOpen ? (
          <View
            style={{
              margin: spacing.lg,
              padding: spacing.lg,
              borderRadius: radius.lg,
              backgroundColor: 'rgba(255,255,255,0.14)',
              gap: spacing.md,
            }}>
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)' }}>
              STOP PLAYING AFTER
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {TIMER_CHOICES.map((minutes) => {
                const active = sleepTimerMinutes === minutes;
                return (
                  <Pressable
                    key={minutes}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Stop playing after ${minutes} minutes`}
                    onPress={() => {
                      setSleepTimerMinutes(active ? null : minutes);
                      setTimerOpen(false);
                    }}
                    style={{
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.pill,
                      backgroundColor: active ? '#FFF' : 'rgba(255,255,255,0.16)',
                    }}>
                    <Txt
                      variant="caption"
                      style={{ color: active ? '#0B1026' : '#FFF', fontWeight: '600' }}>
                      {minutes} min
                    </Txt>
                  </Pressable>
                );
              })}
              {sleepTimerMinutes !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel the sleep timer"
                  onPress={() => {
                    setSleepTimerMinutes(null);
                    setTimerOpen(false);
                  }}
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.4)',
                  }}>
                  <Txt variant="caption" style={{ color: '#FFF' }}>
                    Off
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Mixer */}
        {mixerOpen ? (
          <View
            style={{
              marginHorizontal: spacing.xl,
              marginBottom: spacing.lg,
              padding: spacing.lg,
              borderRadius: radius.lg,
              backgroundColor: 'rgba(255,255,255,0.12)',
              gap: spacing.lg,
            }}>
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.75)' }}>
              BACKGROUND SOUND
            </Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {BACKGROUND_SOUNDS.map((sound) => {
                const selected = backgroundSound === sound.id;
                return (
                  <Pressable
                    key={sound.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setBackgroundSound(sound.id as BackgroundSound)}
                    style={{
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? '#FFF' : 'rgba(255,255,255,0.16)',
                    }}>
                    <Txt
                      variant="caption"
                      style={{ color: selected ? '#131A35' : 'rgba(255,255,255,0.9)' }}>
                      {sound.label}
                    </Txt>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ gap: spacing.sm }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.75)' }}>
                VOLUME
              </Txt>
              <Slider
                value={volume}
                onChange={setVolume}
                accessibilityLabel="Volume"
                minimumTrackColor="#FFFFFF"
                maximumTrackColor="rgba(255,255,255,0.25)"
              />
            </View>
          </View>
        ) : null}

        {/* Transport */}
        <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xl }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.xxl,
            }}>
            <IconButton glyph="↺" label="Rewind 10 seconds" tone="onAccent" onPress={rewind} size={52} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
              onPress={togglePlay}
              style={({ pressed }) => ({
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: '#FFF',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}>
              <Txt style={{ fontSize: 30, color: '#131A35' }}>{playing ? '❚❚' : '▶'}</Txt>
            </Pressable>

            <IconButton
              glyph="■"
              label="End session"
              tone="onAccent"
              size={52}
              onPress={() => void finish(false)}
            />
          </View>

          {/*
            Speed sits below the transport rather than inside it: it is changed
            rarely, and the three primary controls should stay unambiguous.
            Hidden in the fallback mode, where there is no real audio to rate.
          */}
          {!streamFailed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Playback speed, currently ${speed} times. Tap to change.`}
              onPress={cycleSpeed}
              style={{ alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.lg }}>
              <Txt
                variant="micro"
                style={{ color: speed === 1 ? 'rgba(255,255,255,0.6)' : '#FFF' }}>
                {speed}× SPEED
              </Txt>
            </Pressable>
          ) : null}

          <Txt
            variant="micro"
            style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
            {clock(elapsed)} / {clock(duration)}
            {Platform.OS !== 'web' ? '  ·  KEEPS PLAYING WHEN LOCKED' : ''}
          </Txt>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
