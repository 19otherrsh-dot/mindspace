import React from 'react';
import * as Sentry from '@sentry/react-native';
import { PostHogProvider, usePostHog } from 'posthog-react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';

export function initSentry() {
  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 1.0,
      _experiments: {
        profilesSampleRate: 1.0,
      },
    });
  }
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  if (!POSTHOG_API_KEY) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider apiKey={POSTHOG_API_KEY} options={{ host: POSTHOG_HOST }}>
      {children}
    </PostHogProvider>
  );
}

export function useTelemetryIdentity() {
  const posthog = usePostHog();

  return {
    identify: (id: string, properties?: Record<string, any>) => {
      posthog?.identify(id, properties);
      Sentry.setUser({ id, ...properties });
    },
    reset: () => {
      posthog?.reset();
      Sentry.setUser(null);
    }
  };
}
