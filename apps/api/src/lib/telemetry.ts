import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { PostHog } from 'posthog-node';
import { config } from '../config.ts';
import type { Express } from 'express';

// Export a singleton PostHog client
export const posthog = config.telemetry.posthogKey
  ? new PostHog(config.telemetry.posthogKey, { host: config.telemetry.posthogHost })
  : null;

export function initTelemetry(app: Express) {
  if (config.telemetry.sentryDsn) {
    Sentry.init({
      dsn: config.telemetry.sentryDsn,
      integrations: [
        // Add profiling integration
        nodeProfilingIntegration(),
      ],
      // Tracing
      tracesSampleRate: config.env === 'production' ? 0.2 : 1.0, 
      // Profiling
      profilesSampleRate: config.env === 'production' ? 0.2 : 1.0,
      environment: config.env,
    });
  }
}

export function shutdownTelemetry() {
  if (posthog) {
    posthog.shutdown();
  }
}
