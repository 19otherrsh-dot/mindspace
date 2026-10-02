import type { Instructor, InstructorDetail } from '@mindspace/shared';
import { query, queryOne } from '../db/pool.ts';
import { mapSession, SESSION_SELECT, type SessionRow } from './content.ts';
import { COURSE_SELECT, mapCourse, type CourseRow } from './courses.ts';

/**
 * Browsing by teacher (competitor gap: Calm bills its narrators prominently —
 * "with Stephen Fry" — and lets you follow one). The catalogue already had
 * instructors attached to sessions; this exposes them as a browsable entity.
 */

interface InstructorRow {
  id: string;
  slug: string;
  name: string;
  bio: string;
  avatar_url: string | null;
  tagline: string | null;
  session_count: number;
  course_count: number;
  total_minutes: number;
}

const INSTRUCTOR_SELECT = `
  SELECT i.id, i.slug, i.name, i.bio, i.avatar_url, i.tagline,
         (SELECT count(*)::int FROM sessions s
           WHERE s.instructor_id = i.id AND s.is_active) AS session_count,
         (SELECT count(*)::int FROM courses c
           WHERE c.instructor_id = i.id AND c.is_active) AS course_count,
         (SELECT coalesce(round(sum(s.duration_seconds) / 60.0), 0)::int FROM sessions s
           WHERE s.instructor_id = i.id AND s.is_active) AS total_minutes
    FROM instructors i
`;

function mapInstructor(row: InstructorRow): Instructor {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    tagline: row.tagline,
    sessionCount: row.session_count,
    courseCount: row.course_count,
    totalMinutes: row.total_minutes,
  };
}

export async function listInstructors(featuredOnly = false): Promise<Instructor[]> {
  const { rows } = await query<InstructorRow>(
    `${INSTRUCTOR_SELECT}
     ${featuredOnly ? 'WHERE i.is_featured' : ''}
     ORDER BY i.sort_order, i.name`,
  );
  // A teacher with nothing published is a data artefact, not a browse target.
  return rows.filter((row) => row.session_count > 0).map(mapInstructor);
}

export async function getInstructorBySlug(
  slug: string,
  viewerId: string | null,
): Promise<InstructorDetail | null> {
  const row = await queryOne<InstructorRow>(`${INSTRUCTOR_SELECT} WHERE i.slug = $1`, [slug]);
  if (!row) return null;

  const [sessions, courses] = await Promise.all([
    query<SessionRow>(
      `${SESSION_SELECT}
        WHERE s.instructor_id = $2::uuid AND s.is_active
        ORDER BY s.play_count DESC`,
      [viewerId, row.id],
    ),
    query<CourseRow>(
      `${COURSE_SELECT} WHERE c.instructor_id = $2::uuid AND c.is_active ORDER BY c.title`,
      [viewerId, row.id],
    ),
  ]);

  return {
    ...mapInstructor(row),
    slug: row.slug,
    sessions: sessions.rows.map(mapSession),
    courses: courses.rows.map(mapCourse),
  };
}
