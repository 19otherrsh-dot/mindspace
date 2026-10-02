import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { HomeFeed } from '@mindspace/shared';
import { api } from '@/api/client';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Txt } from '@/components/ui';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';

/**
 * Starts today's session immediately.
 *
 * The people who most need the app are the ones with the least attention left
 * to spend opening it and choosing what to play, so every screen between the
 * intent and the audio is somewhere to lose them. This route exists so a
 * reminder, a widget or a home-screen shortcut can go straight to practice —
 * it resolves the daily recommendation, hands it to the player and replaces
 * itself, so Back never returns here.
 */
export default function Start() {
  const router = useRouter();
  const theme = useTheme();
  const play = usePlayerStore((s) => s.play);
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  // `?mode=sleep` comes from the bedtime nudge: at that hour the daily
  // recommendation is the wrong thing to start.
  const sleepMode = useLocalSearchParams<{ mode?: string }>().mode === 'sleep';

  // Strict Mode and re-renders must not fire two sessions.
  const launched = useRef(false);

  useEffect(() => {
    // Wait for the stored session; the auth gate sends signed-out users away.
    if (!hydrated || !user || launched.current) return;
    launched.current = true;

    let cancelled = false;

    (async () => {
      try {
        const feed = await api.get<HomeFeed>('/home');
        if (cancelled) return;

        /*
         * At bedtime, start from the wind-down row rather than the daily
         * recommendation — a focus meditation is the wrong thing to hand
         * someone who is trying to fall asleep.
         */
        const windDown = feed.sections.find((s) => s.id === 'wind-down');
        const chosen =
          sleepMode && windDown?.sessions.length ? windDown.sessions[0]! : feed.daily;

        play(chosen);
        router.replace('/player');
      } catch {
        // Offline, or the feed failed. Home is the honest fallback — it can
        // render downloaded sessions and shows a real error if it cannot.
        if (!cancelled) router.replace('/(tabs)');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, user, play, router, sleepMode]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.lg,
        backgroundColor: theme.colors.background,
      }}>
      <ActivityIndicator color={theme.colors.accent} />
      <Txt variant="caption" tone="muted">
        {sleepMode ? 'Finding something to sleep to' : 'Starting today’s session'}
      </Txt>
    </View>
  );
}
