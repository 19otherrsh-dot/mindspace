import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { companionConfigured } from './llm/index.ts';
import { pool } from './db/pool.ts';
import { initTelemetry } from './lib/telemetry.ts';
import * as Sentry from '@sentry/node';
import { redisAvailable } from './redis.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import { authRouter } from './routes/auth.ts';
import { usersRouter } from './routes/users.ts';
import { contentRouter } from './routes/content.ts';
import { coursesRouter } from './routes/courses.ts';
import { activityRouter } from './routes/activity.ts';
import { statsRouter } from './routes/stats.ts';
import { homeRouter } from './routes/home.ts';
import { subscriptionRouter } from './routes/subscription.ts';
import { companionRouter } from './routes/companion.ts';
import { therapyRouter } from './routes/therapy.ts';
import { legalRouter } from './routes/legal.ts';
import { oauthRouter } from './routes/oauth.ts';
import { webhooksRouter } from './routes/webhooks.ts';
import { notificationsRouter } from './routes/notifications.ts';

/**
 * The Express application, with no side effects on import.
 *
 * Kept separate from `index.ts` so tests can mount it with supertest without
 * binding a port or starting the cron worker — importing the bootstrap was
 * both slow and, because the worker pulls in ESM-only dependencies, a source
 * of spurious test failures.
 */
export function createApp() {
  const app = express();
  initTelemetry(app);

  // Expo dev clients and the Expo Web build all hit this from varying origins.
  app.use(cors({ origin: true, credentials: true }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: '1mb' }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use('/public', express.static(path.resolve(__dirname, '../public')));

  // Behind a load balancer, req.ip must reflect the client for rate limiting.
  app.set('trust proxy', 1);

  /** Liveness plus dependency status, for the 99.9% uptime SLA monitoring. */
  app.get('/health', async (_req, res) => {
    let database = false;
    try {
      await pool.query('SELECT 1');
      database = true;
    } catch {
      database = false;
    }

    res.status(database ? 200 : 503).json({
      status: database ? 'ok' : 'degraded',
      database,
      // Redis being down is survivable, so it does not fail the check.
      redis: redisAvailable(),
      // Likewise the companion: the rest of the app works without a model.
      companion: companionConfigured() ? config.llm.provider : false,
      version: '1.0.0',
    });
  });

  app.use('/auth', authRouter);
  app.use('/auth', oauthRouter);
  app.use('/users', usersRouter);
  app.use('/content', contentRouter);
  app.use('/courses', coursesRouter);
  app.use('/activity', activityRouter);
  app.use('/stats', statsRouter);
  app.use('/home', homeRouter);
  app.use('/subscription', subscriptionRouter);
  app.use('/companion', companionRouter);
  app.use('/therapy', therapyRouter);
  app.use('/legal', legalRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/notifications', notificationsRouter);

  Sentry.setupExpressErrorHandler(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
