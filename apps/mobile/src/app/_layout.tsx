import { useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { setAudioModeAsync } from 'expo-audio';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '@/store/auth';
import { useDownloadsStore } from '@/store/downloads';
import {
  BEDTIME_INTENT,
  REMINDER_INTENT,
  configureNotificationHandler,
  syncAllReminders,
} from '@/notifications/reminders';
import { useTheme } from '@/theme/use-theme';
import { TelemetryProvider, initSentry, useTelemetryIdentity } from '@/lib/telemetry';
import '@/lib/i18n';
// import { registerForPushNotificationsAsync } from '@/notifications/push';

initSentry();

// Must be registered before any notification can arrive.
configureNotificationHandler();

SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden */
});

/**
 * Sends a tapped reminder straight into practice.
 *
 * `useLastNotificationResponse` rather than a listener: a listener only fires
 * while the app is already running, and the case that matters most here is the
 * cold start — the phone was locked, the reminder arrived, and the tap is what
 * launches the app.
 */
function useReminderIntent() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  // One notification must open one session, however often this re-renders.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !hydrated || !user) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;

    const { intent } = response.notification.request.content.data ?? {};

    if (intent === REMINDER_INTENT) {
      handled.current = id;
      router.push('/start');
      return;
    }

    if (intent === BEDTIME_INTENT) {
      handled.current = id;
      // Headspace's Wind Down shape: a short breathing exercise first, then
      // something to fall asleep to. `next` carries the second half.
      router.push('/breathe?next=/start%3Fmode%3Dsleep');
    }
  }, [response, hydrated, user, router]);
}

/**
 * Routes the user to the right place once the stored session has been read:
 * onboarding when signed out, the quiz when signed up but not yet profiled,
 * and the tabs otherwise.
 */
function useAuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);
  const { identify, reset } = useTelemetryIdentity();

  useEffect(() => {
    if (user) {
      identify(user.id, { isGuest: user.isGuest, displayName: user.displayName });
    } else if (hydrated) {
      reset();
    }
  }, [user, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    const group = segments[0];
    const inOnboarding = group === '(onboarding)';

    if (!user) {
      if (!inOnboarding) router.replace('/(onboarding)/welcome');
      return;
    }

    // A signed-in user who skipped the quiz is sent to it once. Guests are
    // exempt so "Try for free" reaches the library in one tap.
    if (!user.onboarding && !user.isGuest && group !== '(onboarding)') {
      router.replace('/(onboarding)/quiz');
      return;
    }

    // A fully set-up user has no reason to sit on an onboarding screen.
    // Anywhere else — the tabs, the player, a modal — is left alone.
    if (inOnboarding && (user.onboarding || user.isGuest)) {
      router.replace('/(tabs)');
    }
  }, [hydrated, user, segments, router]);
}

export default function RootLayout() {
  const theme = useTheme();
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrated = useAuthStore((s) => s.hydrated);

  const hydrateDownloads = useDownloadsStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
    // Reading what is already on disk is independent of the session — it must
    // work before sign-in and with no network at all.
    void hydrateDownloads();
  }, [hydrate, hydrateDownloads]);

  useEffect(() => {
    // Meditation has to keep playing when the screen locks, and must not be
    // silenced by the ringer switch mid-session (PRD §3.2, §5.2).
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      /* audio mode is best-effort on web */
    });
  }, []);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);

  // Re-assert the schedule once the user is known. iOS drops pending local
  // notifications when the app is reinstalled, and preferences may have been
  // changed on another device since this one last ran.
  const preferences = useAuthStore((s) => s.user?.preferences);
  const user = useAuthStore((s) => s.user);
  
  useEffect(() => {
    if (!preferences) return;
    void syncAllReminders(preferences).catch(() => {
      /* the user can retry from Settings */
    });
  }, [preferences]);

  // Request remote push notifications permissions and token for authenticated users
  useEffect(() => {
    if (user && !user.isGuest) {
      // void registerForPushNotificationsAsync();
    }
  }, [user]);

  if (!hydrated) {
    // Held behind the native splash; rendering nothing avoids a flash of the
    // wrong screen before we know whether there is a session.
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  function AuthGateHandler() {
    useAuthGate();
    return null;
  }

  function ReminderIntentHandler() {
    useReminderIntent();
    return null;
  }

  return (
    <TelemetryProvider>
      <AuthGateHandler />
      {Platform.OS !== 'web' && <ReminderIntentHandler />}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style={theme.dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
              animation: 'slide_from_right',
            }}>
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="session/[id]" />
            <Stack.Screen name="collection/[slug]" />
            <Stack.Screen name="course/[slug]" />
            <Stack.Screen name="settings" />

            {/* Fades rather than slides: it is a step on the way to the
                player, not a place, and should not feel like navigation. */}
            <Stack.Screen name="start" options={{ animation: 'fade' }} />

            {/* The player owns the whole screen so nothing competes with it. */}
            <Stack.Screen
              name="player"
              options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen
              name="summary"
              options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen name="mood" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="breathe" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen name="timer" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen name="teacher/[slug]" />
            <Stack.Screen name="companion" />
            <Stack.Screen name="therapy" />
            <Stack.Screen name="therapist/[slug]" />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </TelemetryProvider>
  );
}
