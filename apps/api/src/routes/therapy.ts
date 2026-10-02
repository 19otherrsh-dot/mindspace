import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Appointment } from '@mindspace/shared';
import { config } from '../config.ts';
import { query, queryOne } from '../db/pool.ts';
import { decryptNote, encryptNote } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import {
  availableSlots,
  coversJurisdiction,
  getTherapistById,
  getTherapistBySlug,
  listTherapists,
} from '../services/therapists.ts';

export const therapyRouter = Router();

/** A jurisdiction is a country, optionally with a subdivision: US, US-CA, GB. */
const jurisdictionSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/, 'Use a region like US, US-CA or GB');

/** GET /therapy/therapists */
therapyRouter.get('/therapists', requireAuth, async (req, res) => {
  const params = z
    .object({
      jurisdiction: jurisdictionSchema.optional(),
      specialty: z.string().trim().max(60).optional(),
      language: z.string().trim().max(20).optional(),
    })
    .parse(req.query);

  res.json({ items: await listTherapists(params) });
});

/** GET /therapy/therapists/:slug */
therapyRouter.get('/therapists/:slug', requireAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const { jurisdiction } = z
    .object({ jurisdiction: jurisdictionSchema.optional() })
    .parse(req.query);

  const therapist = await getTherapistBySlug(slug, jurisdiction ?? null);
  if (!therapist) throw notFound('Therapist');

  res.json(therapist);
});

/** GET /therapy/therapists/:slug/slots — bookable times over the next N days. */
therapyRouter.get('/therapists/:slug/slots', requireAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const { days } = z
    .object({ days: z.coerce.number().int().min(1).max(60).default(14) })
    .parse(req.query);

  const therapist = await getTherapistBySlug(slug, null);
  if (!therapist) throw notFound('Therapist');

  res.json({
    therapistId: therapist.id,
    sessionMinutes: therapist.sessionMinutes,
    timezone: therapist.timezone,
    slots: await availableSlots(therapist.id, days),
  });
});

const bookSchema = z.object({
  therapistId: z.string().uuid(),
  startsAt: z.string().datetime(),
  note: z.string().trim().max(2000).optional(),
  jurisdiction: jurisdictionSchema,
});

/** POST /therapy/appointments */
therapyRouter.post('/appointments', requireAuth, async (req, res) => {
  const input = bookSchema.parse(req.body);
  const user = req.user!;

  const therapist = await getTherapistById(input.therapistId);
  if (!therapist) throw notFound('Therapist');
  if (!therapist.accepting_clients) {
    throw conflict('This therapist is not accepting new clients right now.');
  }

  /*
   * Licensing is a legal constraint, not a filter. A client can only be seen
   * by someone licensed where they are, so this is checked at write time —
   * the directory's `availableInYourRegion` flag is a hint for the UI, and a
   * hint is not enforcement.
   */
  if (!coversJurisdiction(therapist.licences, input.jurisdiction)) {
    throw forbidden(
      `${therapist.full_name} is not licensed to practise in ${input.jurisdiction}. ` +
        'Filter the directory by your region to see who can see you.',
    );
  }

  // Re-derive the slot list rather than trusting a client-supplied time: it
  // enforces notice period, availability windows and time-off in one step.
  const slots = await availableSlots(therapist.id, 60);
  const requested = new Date(input.startsAt).toISOString();
  const slot = slots.find((candidate) => candidate.startsAt === requested);

  if (!slot) {
    throw conflict('That time is no longer available. Please pick another slot.');
  }

  const videoRoom = `mindspace-${randomUUID()}`;

  try {
    const created = await queryOne<{ id: string; created_at: Date }>(
      `INSERT INTO appointments
         (therapist_id, user_id, starts_at, ends_at, video_room, note_encrypted,
          jurisdiction, price_cents, currency)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        therapist.id,
        user.id,
        slot.startsAt,
        slot.endsAt,
        videoRoom,
        encryptNote(input.note),
        input.jurisdiction,
        therapist.session_price_cents,
        therapist.currency,
      ],
    );

    res.status(201).json(
      toAppointment({
        id: created!.id,
        therapist_id: therapist.id,
        slug: therapist.slug,
        full_name: therapist.full_name,
        credentials: therapist.credentials,
        avatar_url: therapist.avatar_url,
        starts_at: new Date(slot.startsAt),
        ends_at: new Date(slot.endsAt),
        status: 'scheduled',
        video_room: videoRoom,
        note_encrypted: encryptNote(input.note),
        price_cents: therapist.session_price_cents,
        currency: therapist.currency,
        created_at: created!.created_at,
      }),
    );
  } catch (err) {
    // The partial unique index is what actually prevents a double booking;
    // two clients racing for the last slot both pass the check above.
    if ((err as { code?: string }).code === '23505') {
      throw conflict('Someone just booked that time. Please pick another slot.');
    }
    throw err;
  }
});

/** GET /therapy/appointments — the client's own bookings. */
therapyRouter.get('/appointments', requireAuth, async (req, res) => {
  const { scope } = z
    .object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming') })
    .parse(req.query);

  const filters = ['a.user_id = $1::uuid'];
  if (scope === 'upcoming') filters.push("a.starts_at >= now() AND a.status = 'scheduled'");
  if (scope === 'past') filters.push("(a.starts_at < now() OR a.status <> 'scheduled')");

  const { rows } = await query<AppointmentRow>(
    `SELECT a.id, a.therapist_id, t.slug, t.full_name, t.credentials, t.avatar_url,
            a.starts_at, a.ends_at, a.status, a.video_room, a.note_encrypted,
            a.price_cents, a.currency, a.created_at
       FROM appointments a
       JOIN therapists t ON t.id = a.therapist_id
      WHERE ${filters.join(' AND ')}
      ORDER BY a.starts_at ${scope === 'past' ? 'DESC' : 'ASC'}`,
    [req.user!.id],
  );

  res.json({ items: rows.map(toAppointment) });
});

/** DELETE /therapy/appointments/:id — client-side cancellation. */
therapyRouter.delete('/appointments/:id', requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const appointment = await queryOne<{ starts_at: Date; status: string }>(
    'SELECT starts_at, status FROM appointments WHERE id = $1::uuid AND user_id = $2::uuid',
    [id, req.user!.id],
  );
  if (!appointment) throw notFound('Appointment');
  if (appointment.status !== 'scheduled') throw badRequest('That appointment is not active.');

  // Cancelling minutes beforehand still costs the clinician the hour, so the
  // window is a real policy rather than a UI nicety.
  const hoursAway = (appointment.starts_at.getTime() - Date.now()) / 3_600_000;
  if (hoursAway < 24) {
    throw conflict(
      'Appointments can only be cancelled more than 24 hours in advance. ' +
        'Please contact your therapist directly.',
    );
  }

  await query(
    `UPDATE appointments SET status = 'cancelled_by_client', cancelled_at = now()
      WHERE id = $1::uuid`,
    [id],
  );
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

interface AppointmentRow {
  id: string;
  therapist_id: string;
  slug: string;
  full_name: string;
  credentials: string;
  avatar_url: string | null;
  starts_at: Date;
  ends_at: Date;
  status: Appointment['status'];
  video_room: string;
  note_encrypted: Buffer | null;
  price_cents: number;
  currency: string;
  created_at: Date;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    therapist: {
      id: row.therapist_id,
      slug: row.slug,
      fullName: row.full_name,
      credentials: row.credentials,
      avatarUrl: row.avatar_url,
    },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    videoUrl: `${config.videoBaseUrl}/${row.video_room}`,
    note: decryptNote(row.note_encrypted),
    priceCents: row.price_cents,
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
  };
}
