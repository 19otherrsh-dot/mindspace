import Redis from 'ioredis';
import { config } from './config.ts';

/**
 * Redis backs the home-feed cache and the per-IP auth rate limiter. Neither is
 * load-bearing for correctness, so a Redis outage degrades to "slower and
 * unthrottled" rather than taking the API down with it.
 */
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
});

let available = false;

redis.on('ready', () => {
  available = true;
  console.log('[redis] connected');
});

redis.on('error', (err) => {
  if (available) console.warn('[redis] connection lost:', err.message);
  available = false;
});

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
  } catch (err) {
    console.warn(
      `[redis] unavailable at ${config.redisUrl} — caching and rate limiting are disabled. ` +
        `(${(err as Error).message})`,
    );
  }
}

export function redisAvailable(): boolean {
  return available;
}

/** Reads a cached JSON value, returning null on any miss or Redis failure. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!available) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!available) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Cache writes are best-effort.
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (!available || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // Ignore.
  }
}

/**
 * Fixed-window counter. Returns the current count for the window; callers
 * compare it against their own limit. Fails open when Redis is down.
 */
export async function incrementWindow(key: string, windowSeconds: number): Promise<number> {
  if (!available) return 0;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count;
  } catch {
    return 0;
  }
}
