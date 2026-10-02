import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../db/pool.ts';
import { notFound, paywall } from '../lib/errors.ts';
import { hasProAccess, optionalAuth, requireAuth } from '../middleware/auth.ts';
import { enroll, getCourseBySlug, listCourses } from '../services/courses.ts';

export const coursesRouter = Router();

/** GET /courses — the Courses hub (screen 12). */
coursesRouter.get('/', optionalAuth, async (req, res) => {
  const { filter } = z
    .object({ filter: z.enum(['all', 'in_progress', 'completed']).default('all') })
    .parse(req.query);

  // The in-progress and completed tabs are meaningless without a user.
  if (filter !== 'all' && !req.user) return res.json({ items: [] });

  res.json({ items: await listCourses(req.user?.id ?? null, filter) });
});

/** GET /courses/:slug — course detail with the day-by-day list (screen 13). */
coursesRouter.get('/:slug', optionalAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

  const course = await getCourseBySlug(slug, req.user?.id ?? null);
  if (!course) throw notFound('Course');

  // Locked courses still show their full day list as a preview; the stream
  // URLs are blanked so the paywall cannot be bypassed by reading the payload.
  if (course.isPro && !hasProAccess(req.user)) {
    course.days = course.days?.map((day) => ({
      ...day,
      session: { ...day.session, streamUrl: '' },
    }));
  }

  res.json(course);
});

/** POST /courses/:slug/enroll */
coursesRouter.post('/:slug/enroll', requireAuth, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

  const course = await queryOne<{ id: string; is_pro: boolean }>(
    'SELECT id, is_pro FROM courses WHERE slug = $1 AND is_active',
    [slug],
  );
  if (!course) throw notFound('Course');

  if (course.is_pro && !hasProAccess(req.user)) {
    throw paywall('This course is part of Mindspace Pro');
  }

  await enroll(req.user!.id, course.id);

  const enrolled = await getCourseBySlug(slug, req.user!.id);
  res.status(201).json(enrolled);
});
