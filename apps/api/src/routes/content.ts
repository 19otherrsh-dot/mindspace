import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  FREE_DOWNLOAD_LIMIT,
  PRO_DOWNLOAD_LIMIT,
  type Paginated,
  type Session,
} from '@mindspace/shared';
import { query, queryOne } from '../db/pool.ts';
import { badRequest, conflict, notFound, paywall } from '../lib/errors.ts';
import { hasProAccess, optionalAuth, requireAuth } from '../middleware/auth.ts';
import {
  getCollectionBySlug,
  getRelatedSessions,
  getSessionById,
  getSessionsByIds,
  listCollections,
  searchSessions,
} from '../services/content.ts';
import { getInstructorBySlug, listInstructors } from '../services/instructors.ts';

export const contentRouter = Router();

/**
 * Browse responses must not carry playable URLs for content the caller has not
 * paid for — otherwise the paywall is a client-side suggestion. Locked items
 * still appear in the library (with artwork, title and a Pro badge); only the
 * stream is blanked, and `GET /sessions/:id/stream` re-checks entitlement.
 */
function withEntitlement(sessions: Session[], req: Request): Session[] {
  const pro = hasProAccess(req.user);
  return sessions.map((s) => (s.isPro && !pro ? { ...s, streamUrl: '' } : s));
}

const categorySchema = z.enum([
  'stress',
  'anxiety',
  'sleep',
  'focus',
  'relationships',
  'sports',
  'beginners',
]);

const formatSchema = z.enum([
  'meditation',
  'sleepcast',
  'sleep_music',
  'focus_music',
  'mini',
  'movement',
  'wind_down',
  'unguided',
]);

const exploreSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: categorySchema.optional(),
  format: formatSchema.optional(),
  length: z.enum(['short', 'long']).optional(),
  // Query strings arrive as text, so coerce the non-string types.
  freeOnly: z.coerce.boolean().optional(),
  sort: z.enum(['popular', 'new', 'duration']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** GET /content/sessions — the Explore grid and search (screen 7). */
contentRouter.get('/sessions', optionalAuth, async (req, res) => {
  const params = exploreSchema.parse(req.query);
  const viewerId = req.user?.id ?? null;

  const { sessions, total } = await searchSessions(params, viewerId);

  const body: Paginated<Session> = {
    items: withEntitlement(sessions, req),
    total,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  };
  res.json(body);
});

/** GET /content/sessions/:id — pre-play detail (screen 9). */
contentRouter.get('/sessions/:id', optionalAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const viewerId = req.user?.id ?? null;

  const session = await getSessionById(id, viewerId);
  if (!session) throw notFound('Session');

  const related = await getRelatedSessions(session.id, session.category, viewerId);
  const [safeSession] = withEntitlement([session], req);
  res.json({ session: safeSession, related: withEntitlement(related, req) });
});

/**
 * GET /content/sessions/:id/stream — resolves the playable URL.
 * The stream URL is withheld from the list endpoints' Pro items and only
 * handed out here, after the entitlement check.
 */
contentRouter.get('/sessions/:id/stream', requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const session = await getSessionById(id, req.user!.id);
  if (!session) throw notFound('Session');

  if (session.isPro && !hasProAccess(req.user)) throw paywall();

  res.json({
    streamUrl: session.streamUrl,
    durationSeconds: session.durationSeconds,
  });
});

/** GET /content/collections */
contentRouter.get('/collections', optionalAuth, async (req, res) => {
  const { featured } = z.object({ featured: z.coerce.boolean().optional() }).parse(req.query);
  res.json({ items: await listCollections(featured ?? false) });
});

/** GET /content/collections/:slug — category / collection page (screen 8). */
contentRouter.get('/collections/:slug', optionalAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const { sort } = z
    .object({ sort: z.enum(['popular', 'new', 'duration']).optional() })
    .parse(req.query);

  const collection = await getCollectionBySlug(slug, req.user?.id ?? null, sort ?? 'popular');
  if (!collection) throw notFound('Collection');

  res.json({ ...collection, sessions: withEntitlement(collection.sessions ?? [], req) });
});

/* ------------------------------------------------------------------ */
/* Teachers                                                            */
/* ------------------------------------------------------------------ */

/** GET /content/teachers — the narrator directory. */
contentRouter.get('/teachers', optionalAuth, async (req, res) => {
  const { featured } = z.object({ featured: z.coerce.boolean().optional() }).parse(req.query);
  res.json({ items: await listInstructors(featured ?? false) });
});

/** GET /content/teachers/:slug — one teacher and everything they narrate. */
contentRouter.get('/teachers/:slug', optionalAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

  const teacher = await getInstructorBySlug(slug, req.user?.id ?? null);
  if (!teacher) throw notFound('Teacher');

  res.json({ ...teacher, sessions: withEntitlement(teacher.sessions, req) });
});

/* ------------------------------------------------------------------ */
/* Favourites                                                          */
/* ------------------------------------------------------------------ */

/** GET /content/favourites — the Favourites tab on the profile (screen 15). */
contentRouter.get('/favourites', requireAuth, async (req, res) => {
  const { rows } = await query<{ session_id: string }>(
    'SELECT session_id FROM favourites WHERE user_id = $1::uuid ORDER BY created_at DESC',
    [req.user!.id],
  );

  const sessions = await getSessionsByIds(
    rows.map((r) => r.session_id),
    req.user!.id,
  );
  res.json({ items: withEntitlement(sessions, req) });
});

contentRouter.put('/favourites/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);

  const exists = await queryOne('SELECT 1 FROM sessions WHERE id = $1::uuid', [sessionId]);
  if (!exists) throw notFound('Session');

  await query(
    `INSERT INTO favourites (user_id, session_id) VALUES ($1::uuid, $2::uuid)
     ON CONFLICT DO NOTHING`,
    [req.user!.id, sessionId],
  );
  res.status(204).end();
});

contentRouter.delete('/favourites/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
  await query('DELETE FROM favourites WHERE user_id = $1::uuid AND session_id = $2::uuid', [
    req.user!.id,
    sessionId,
  ]);
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Offline downloads (Pro)                                             */
/* ------------------------------------------------------------------ */

/** POST /content/downloads — records that the client stored a session offline. */
contentRouter.post('/downloads', requireAuth, async (req, res) => {
  const { sessionId, bytes } = z
    .object({ sessionId: z.string().uuid(), bytes: z.number().int().min(0).default(0) })
    .parse(req.body);

  const session = await getSessionById(sessionId, req.user!.id);
  if (!session) throw notFound('Session');

  const pro = hasProAccess(req.user);

  // Free downloads exist so the habit can survive a commute; they do not
  // unlock the catalogue. Pro audio still needs a subscription.
  if (session.isPro && !pro) {
    throw paywall('This session is part of Mindspace Pro');
  }

  const limit = pro ? PRO_DOWNLOAD_LIMIT : FREE_DOWNLOAD_LIMIT;

  const count = await queryOne<{ count: number }>(
    'SELECT count(*)::int AS count FROM downloads WHERE user_id = $1::uuid',
    [req.user!.id],
  );

  // PRD §3.1 caps Pro downloads at 50; the free tier gets a taste.
  if ((count?.count ?? 0) >= limit && !session.isDownloaded) {
    throw conflict(
      pro
        ? `You can keep ${PRO_DOWNLOAD_LIMIT} sessions offline. Remove one to download another.`
        : `Free accounts can keep ${FREE_DOWNLOAD_LIMIT} sessions offline. ` +
          `Remove one, or go Pro for ${PRO_DOWNLOAD_LIMIT}.`,
    );
  }

  await query(
    `INSERT INTO downloads (user_id, session_id, bytes) VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (user_id, session_id) DO UPDATE SET bytes = EXCLUDED.bytes`,
    [req.user!.id, sessionId, bytes],
  );

  res.status(201).json({ streamUrl: session.streamUrl });
});

contentRouter.get('/downloads', requireAuth, async (req, res) => {
  const { rows } = await query<{ session_id: string; bytes: string }>(
    'SELECT session_id, bytes FROM downloads WHERE user_id = $1::uuid ORDER BY downloaded_at DESC',
    [req.user!.id],
  );
  res.json({ items: rows.map((r) => ({ sessionId: r.session_id, bytes: Number(r.bytes) })) });
});

contentRouter.delete('/downloads/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(req.params);
  await query('DELETE FROM downloads WHERE user_id = $1::uuid AND session_id = $2::uuid', [
    req.user!.id,
    sessionId,
  ]);
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Ratings                                                             */
/* ------------------------------------------------------------------ */

/** PUT /content/sessions/:id/rating — feeds the user-ratings quality gate. */
contentRouter.put('/sessions/:id/rating', requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { rating } = z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body);

  const played = await queryOne(
    'SELECT 1 FROM session_completions WHERE user_id = $1::uuid AND session_id = $2::uuid LIMIT 1',
    [req.user!.id, id],
  );
  if (!played) throw badRequest('You can only rate a session you have listened to');

  await query(
    `INSERT INTO session_ratings (user_id, session_id, rating)
     VALUES ($1::uuid, $2::uuid, $3)
     ON CONFLICT (user_id, session_id)
     DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
    [req.user!.id, id, rating],
  );

  res.status(204).end();
});
