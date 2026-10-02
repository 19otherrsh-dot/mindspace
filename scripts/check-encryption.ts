/**
 * Asserts that everything the user types in confidence is ciphertext on disk.
 *
 * Mood notes, sleep notes, clinical booking notes and companion messages are
 * all health information. This reads the raw columns and fails loudly if any
 * of them can be read, which is the one property that cannot be checked from
 * the API — every endpoint decrypts on the way out, so a broken cipher would
 * look perfectly healthy from outside.
 *
 * Run against a seeded, exercised database:
 *   pnpm api && pnpm smoke && pnpm check:encryption
 */
import { query } from '../apps/api/src/db/pool.ts';

interface Target {
  label: string;
  table: string;
  column: string;
  /** A phrase the regression scripts write, which must never appear raw. */
  canary: string;
}

const TARGETS: Target[] = [
  { label: 'mood notes', table: 'mood_entries', column: 'note_encrypted', canary: 'clearer' },
  { label: 'sleep notes', table: 'sleep_entries', column: 'note_ciphertext', canary: 'restless' },
  { label: 'booking notes', table: 'appointments', column: 'note_encrypted', canary: 'sleeping badly' },
];

let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(46)} ${detail}`);
}

/*
 * Wrapped rather than written at the top level: this file sits outside the API
 * package, so it is loaded as CommonJS and top-level await is unavailable.
 */
async function main(): Promise<void> {
for (const target of TARGETS) {
  const { rows } = await query<{ total: number; readable: number; sample: string | null }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${target.column}::text ILIKE $1)::int AS readable,
            -- Encode first: there is no max() over bytea, but there is over text.
            max(encode(substring(${target.column} from 1 for 12), 'hex')) AS sample
       FROM ${target.table}
      WHERE ${target.column} IS NOT NULL`,
    [`%${target.canary}%`],
  );

  const row = rows[0]!;
  if (row.total === 0) {
    console.log(`  [skip] ${target.label.padEnd(46)} no rows yet`);
    continue;
  }

  report(
    row.readable === 0,
    `${target.label} are unreadable at rest`,
    `${row.total} row(s), ${row.readable} readable, head ${row.sample}`,
  );
}

// Companion messages live behind their own table and column name.
const messages = await query<{ total: number; readable: number }>(
  `SELECT count(*)::int AS total,
          count(*) FILTER (
            WHERE content_encrypted::text ILIKE '%stressful day%'
          )::int AS readable
     FROM companion_messages
    WHERE content_encrypted IS NOT NULL`,
);
if (messages.rows[0]!.total > 0) {
  report(
    messages.rows[0]!.readable === 0,
    'companion messages are unreadable at rest',
    `${messages.rows[0]!.total} row(s), ${messages.rows[0]!.readable} readable`,
  );
}

// Safety events must record that something happened, never what was said.
const safety = await query<{ columns: string }>(
  `SELECT string_agg(column_name, ', ' ORDER BY column_name) AS columns
     FROM information_schema.columns
    WHERE table_name = 'companion_safety_events'`,
);
const columns = safety.rows[0]?.columns ?? '';
report(
  !/message|content|text|body/i.test(columns),
  'safety events store no message text',
  columns,
);

console.log('');
if (failures === 0) {
  console.log('ENCRYPTION OK');
  process.exit(0);
}
console.log(`ENCRYPTION FAILED - ${failures} check(s) did not pass`);
process.exit(1);
}

main().catch((err) => {
  console.error('ENCRYPTION CHECK FAILED TO RUN:', err);
  process.exit(1);
});
