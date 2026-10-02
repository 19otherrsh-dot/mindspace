import type { AppointmentSlot, Therapist, TherapistLicence } from '@mindspace/shared';
import { query } from '../db/pool.ts';

/**
 * Therapist directory and availability.
 *
 * Two things here are correctness-critical rather than cosmetic:
 *
 *  1. **Jurisdiction.** A clinician may only see clients where they are
 *     licensed. That is checked when a booking is written, not merely shown.
 *  2. **Slot generation across timezones.** Availability is stored as a
 *     weekday plus a wall-clock window in the *therapist's* zone. Turning that
 *     into absolute instants has to go through the zone, because a fixed UTC
 *     offset silently breaks twice a year at daylight-saving boundaries.
 */

interface TherapistRow {
  id: string;
  slug: string;
  full_name: string;
  credentials: string;
  headline: string;
  bio: string;
  avatar_url: string | null;
  timezone: string;
  languages: string[];
  specialties: string[];
  session_price_cents: number;
  currency: string;
  session_minutes: number;
  min_notice_hours: number;
  accepting_clients: boolean;
}

const THERAPIST_SELECT = `
  SELECT id, slug, full_name, credentials, headline, bio, avatar_url, timezone,
         languages, specialties, session_price_cents, currency, session_minutes,
         min_notice_hours, accepting_clients
    FROM therapists
`;

function mapTherapist(
  row: TherapistRow,
  licences: TherapistLicence[],
  jurisdiction: string | null,
): Therapist {
  return {
    id: row.id,
    slug: row.slug,
    fullName: row.full_name,
    credentials: row.credentials,
    headline: row.headline,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    languages: row.languages,
    specialties: row.specialties,
    sessionPriceCents: row.session_price_cents,
    currency: row.currency,
    sessionMinutes: row.session_minutes,
    acceptingClients: row.accepting_clients,
    licences,
    availableInYourRegion: jurisdiction ? coversJurisdiction(licences, jurisdiction) : false,
  };
}

/**
 * A licence for "US-CA" covers a client in "US-CA"; a licence for "GB" covers
 * all of "GB". Matching is therefore prefix-based on the region, never equality.
 */
export function coversJurisdiction(licences: TherapistLicence[], jurisdiction: string): boolean {
  const target = jurisdiction.toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  return licences.some((licence) => {
    if (licence.expiresOn && licence.expiresOn < today) return false;

    const held = licence.jurisdiction.toUpperCase();
    // "US" covers "US-CA"; "US-CA" does not cover "US-NY".
    return target === held || target.startsWith(`${held}-`);
  });
}

async function licencesFor(therapistIds: string[]): Promise<Map<string, TherapistLicence[]>> {
  if (therapistIds.length === 0) return new Map();

  const { rows } = await query<{
    therapist_id: string;
    jurisdiction: string;
    licence_body: string;
    licence_number: string;
    expires_on: string | null;
  }>(
    `SELECT therapist_id, jurisdiction, licence_body, licence_number, expires_on
       FROM therapist_licences
      WHERE therapist_id = ANY($1::uuid[])`,
    [therapistIds],
  );

  const byTherapist = new Map<string, TherapistLicence[]>();
  for (const row of rows) {
    const list = byTherapist.get(row.therapist_id) ?? [];
    list.push({
      jurisdiction: row.jurisdiction,
      licenceBody: row.licence_body,
      licenceNumber: row.licence_number,
      expiresOn: row.expires_on,
    });
    byTherapist.set(row.therapist_id, list);
  }
  return byTherapist;
}

export interface TherapistQuery {
  jurisdiction?: string;
  specialty?: string;
  language?: string;
}

export async function listTherapists(params: TherapistQuery): Promise<Therapist[]> {
  const where = ['is_active', 'accepting_clients'];
  const values: unknown[] = [];
  let i = 1;

  if (params.specialty) {
    where.push(`$${i++} = ANY(specialties)`);
    values.push(params.specialty);
  }
  if (params.language) {
    where.push(`$${i++} = ANY(languages)`);
    values.push(params.language);
  }

  const { rows } = await query<TherapistRow>(
    `${THERAPIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY full_name`,
    values,
  );

  const licences = await licencesFor(rows.map((r) => r.id));
  const therapists = rows.map((row) =>
    mapTherapist(row, licences.get(row.id) ?? [], params.jurisdiction ?? null),
  );

  // Someone the client cannot legally book is noise at the top of a list, so
  // sort them down rather than hiding them — the reason is worth showing.
  return therapists.sort(
    (a, b) => Number(b.availableInYourRegion) - Number(a.availableInYourRegion),
  );
}

export async function getTherapistBySlug(
  slug: string,
  jurisdiction: string | null,
): Promise<Therapist | null> {
  const { rows } = await query<TherapistRow>(`${THERAPIST_SELECT} WHERE slug = $1 AND is_active`, [
    slug,
  ]);
  const row = rows[0];
  if (!row) return null;

  const licences = await licencesFor([row.id]);
  return mapTherapist(row, licences.get(row.id) ?? [], jurisdiction);
}

export async function getTherapistById(id: string): Promise<
  (TherapistRow & { licences: TherapistLicence[] }) | null
> {
  const { rows } = await query<TherapistRow>(`${THERAPIST_SELECT} WHERE id = $1::uuid AND is_active`, [
    id,
  ]);
  const row = rows[0];
  if (!row) return null;

  const licences = await licencesFor([row.id]);
  return { ...row, licences: licences.get(row.id) ?? [] };
}

/* ------------------------------------------------------------------ */
/* Slot generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * The offset, in minutes, between UTC and `timezone` at a given instant.
 *
 * Derived by formatting the instant in that zone and diffing — which is the
 * only way to get it right across daylight-saving transitions without pulling
 * in a timezone library.
 */
function offsetMinutes(timezone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );

  // The same wall-clock reading, interpreted as if it were UTC.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders midnight as 24 in some locales.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return (asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/** The instant at which `wallClock` occurs on `date` in `timezone`. */
function instantFor(timezone: string, date: string, minutesIntoDay: number): Date {
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, 0, minutesIntoDay);

  // Two passes: the first offset is measured at the wrong instant when the
  // window straddles a DST change, so re-measure using the corrected guess.
  const firstGuess = new Date(naive - offsetMinutes(timezone, new Date(naive)) * 60_000);
  const corrected = new Date(naive - offsetMinutes(timezone, firstGuess) * 60_000);
  return corrected;
}

/** "YYYY-MM-DD" and weekday for an instant, in the given zone. */
function localParts(timezone: string, at: Date): { date: string; weekday: number } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(at);

  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  return { date, weekday };
}

function minutesFromTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Bookable slots for a therapist over the next `days` days.
 *
 * Excludes anything already booked, anything inside a time-off block, and
 * anything closer than the therapist's minimum notice.
 */
export async function availableSlots(
  therapistId: string,
  days = 14,
): Promise<AppointmentSlot[]> {
  const therapist = await getTherapistById(therapistId);
  if (!therapist || !therapist.accepting_clients) return [];

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + days * 86_400_000);
  const earliest = new Date(now.getTime() + therapist.min_notice_hours * 3_600_000);

  const [windows, booked, timeOff] = await Promise.all([
    query<{ weekday: number; start_time: string; end_time: string }>(
      `SELECT weekday, start_time, end_time FROM therapist_availability
        WHERE therapist_id = $1::uuid ORDER BY weekday, start_time`,
      [therapistId],
    ),
    query<{ starts_at: Date }>(
      `SELECT starts_at FROM appointments
        WHERE therapist_id = $1::uuid AND status = 'scheduled' AND starts_at >= $2`,
      [therapistId, now],
    ),
    query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM therapist_time_off
        WHERE therapist_id = $1::uuid AND ends_at >= $2 AND starts_at <= $3`,
      [therapistId, now, horizonEnd],
    ),
  ]);

  if (windows.rows.length === 0) return [];

  const bookedStarts = new Set(booked.rows.map((row) => row.starts_at.getTime()));
  const byWeekday = new Map<number, Array<{ start: number; end: number }>>();
  for (const row of windows.rows) {
    const list = byWeekday.get(row.weekday) ?? [];
    list.push({ start: minutesFromTime(row.start_time), end: minutesFromTime(row.end_time) });
    byWeekday.set(row.weekday, list);
  }

  const slots: AppointmentSlot[] = [];
  const durationMs = therapist.session_minutes * 60_000;

  // Walk calendar days in the therapist's zone, not the server's.
  for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
    const cursor = new Date(now.getTime() + dayOffset * 86_400_000);
    const { date, weekday } = localParts(therapist.timezone, cursor);

    for (const window of byWeekday.get(weekday) ?? []) {
      for (
        let minute = window.start;
        minute + therapist.session_minutes <= window.end;
        minute += therapist.session_minutes
      ) {
        const startsAt = instantFor(therapist.timezone, date, minute);
        const endsAt = new Date(startsAt.getTime() + durationMs);

        if (startsAt < earliest || startsAt > horizonEnd) continue;
        if (bookedStarts.has(startsAt.getTime())) continue;

        const blocked = timeOff.rows.some(
          (block) => startsAt < block.ends_at && endsAt > block.starts_at,
        );
        if (blocked) continue;

        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      }
    }
  }

  // A day can be generated twice when the horizon straddles a zone boundary.
  const seen = new Set<string>();
  return slots
    .filter((slot) => (seen.has(slot.startsAt) ? false : (seen.add(slot.startsAt), true)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
