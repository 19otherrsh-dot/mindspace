import pg from 'pg';
import { config, isProduction } from '../config.ts';

const { Pool } = pg;

/**
 * Postgres returns DATE columns as JS Date objects in the server's timezone,
 * which silently shifts activity days across midnight. Every DATE we read is a
 * calendar day in the user's own timezone, so keep it as the literal string.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

/** NUMERIC arrives as a string to preserve precision; our uses are all small averages. */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: isProduction ? { rejectUnauthorized: true } : undefined,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Returns the first row, or null when the query matched nothing. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
