import { jest } from '@jest/globals';
import request from 'supertest';

/**
 * Jest runs this package as real ESM (see the `--experimental-vm-modules` flag
 * on the test script), which changes two things: `jest` is an import rather
 * than a global, and `jest.mock` no longer hoists above imports. Mocks must be
 * registered with `unstable_mockModule` *before* the module under test is
 * pulled in, hence the dynamic import below.
 */

jest.unstable_mockModule('../db/pool.ts', () => ({
  pool: {
    query: jest.fn<() => Promise<unknown>>().mockResolvedValue({ rowCount: 1 }),
    end: jest.fn(),
    connect: jest.fn(),
  },
  query: jest.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [] }),
  queryOne: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
  transaction: jest.fn(),
}));

// Every export must be present, not just the ones this test touches: the
// whole router tree is imported, and a missing name is a link-time error.
jest.unstable_mockModule('../redis.ts', () => ({
  redis: { disconnect: jest.fn() },
  connectRedis: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  redisAvailable: jest.fn(() => true),
  cacheGet: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  cacheSet: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  cacheDelete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  // Returning 1 keeps every rate limiter well under its threshold.
  incrementWindow: jest.fn<() => Promise<number>>().mockResolvedValue(1),
}));

// `app.ts`, not `index.ts`: the latter binds a port and starts the cron worker
// on import, which a unit test must not do.
const { app } = await import('../app.ts');

describe('GET /health', () => {
  it('returns 200 ok when dependencies are up', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      database: true,
      redis: true,
    });
    expect(response.body).toHaveProperty('version');
  });

  it('handles 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route-123');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'not_found',
        message: 'No route for GET /unknown-route-123',
      },
    });
  });
});
