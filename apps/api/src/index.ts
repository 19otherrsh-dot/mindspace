import { app } from './app.ts';
import { config } from './config.ts';
import { pool } from './db/pool.ts';
import { connectRedis, redis, redisAvailable } from './redis.ts';
import { startPushReceiptWorker } from './worker.ts';

/**
 * Process bootstrap: binds the port, connects Redis, starts the background
 * worker, and handles shutdown. The application itself lives in `app.ts` and
 * has no side effects on import, so tests never come through here.
 */

let server: import('http').Server | null = null;

connectRedis()
  .then(() => {
    server = app.listen(config.port, () => {
      console.log(`[api] listening on http://localhost:${config.port} (${config.env})`);
      startPushReceiptWorker();
    });
  })
  .catch((err) => {
    console.error('[api] failed to start', err);
    process.exit(1);
  });

/** Finish in-flight requests before dropping the connection pools. */
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received, shutting down`);

  const closePools = async () => {
    try {
      await pool.end();
      if (redisAvailable()) redis.disconnect();
    } finally {
      process.exit(0);
    }
  };

  if (server) server.close(() => void closePools());
  else await closePools();

  // Do not let a hung connection keep the process alive indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
