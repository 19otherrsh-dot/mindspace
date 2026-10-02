import type { Course, CourseDay, CourseEnrollment } from '@mindspace/shared';
import { query } from '../db/pool.ts';
import { mapSession, SESSION_SELECT, type SessionRow } from './content.ts';

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  artwork_url: string;
  accent_color: string;
  total_days: number;
  is_pro: boolean;
  rating_sum: number;
  rating_count: number;
  instructor_id: string | null;
  instructor_name: string | null;
  instructor_bio: string | null;
  instructor_avatar_url: string | null;
  enrolled_at: Date | null;
  days_completed: number | null;
  enrollment_completed_at: Date | null;
  certificate_url: string | null;
}

/** $1 is the viewing user's id, or NULL when browsing anonymously. */
const COURSE_SELECT = `
  SELECT c.id, c.slug, c.title, c.description, c.artwork_url, c.accent_color,
         c.total_days, c.is_pro, c.rating_sum, c.rating_count,
         i.id AS instructor_id, i.name AS instructor_name,
         i.bio AS instructor_bio, i.avatar_url AS instructor_avatar_url,
         e.enrolled_at, e.days_completed,
         e.completed_at AS enrollment_completed_at, e.certificate_url
    FROM courses c
    LEFT JOIN instructors i ON i.id = c.instructor_id
    LEFT JOIN course_enrollments e ON e.course_id = c.id AND e.user_id = $1::uuid
`;

function mapEnrollment(row: CourseRow): CourseEnrollment | null {
  if (!row.enrolled_at) return null;
  const daysCompleted = row.days_completed ?? 0;
  return {
    courseId: row.id,
    enrolledAt: row.enrolled_at.toISOString(),
    daysCompleted,
    // Clamp so a finished course resumes on its last day rather than day N+1.
    nextDayNumber: Math.min(daysCompleted + 1, row.total_days),
    completedAt: row.enrollment_completed_at?.toISOString() ?? null,
    certificateUrl: row.certificate_url,
  };
}

function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    artworkUrl: row.artwork_url,
    accentColor: row.accent_color,
    instructor: row.instructor_id
      ? {
          id: row.instructor_id,
          name: row.instructor_name ?? '',
          bio: row.instructor_bio ?? '',
          avatarUrl: row.instructor_avatar_url,
        }
      : null,
    totalDays: row.total_days,
    isPro: row.is_pro,
    rating: row.rating_count > 0 ? Number((row.rating_sum / row.rating_count).toFixed(2)) : 0,
    ratingCount: row.rating_count,
    enrollment: mapEnrollment(row),
  };
}

export type CourseFilter = 'all' | 'in_progress' | 'completed';

export async function listCourses(
  viewerId: string | null,
  filter: CourseFilter = 'all',
): Promise<Course[]> {
  const where = ['c.is_active'];
  if (filter === 'in_progress') {
    where.push('e.enrolled_at IS NOT NULL AND e.completed_at IS NULL');
  } else if (filter === 'completed') {
    where.push('e.completed_at IS NOT NULL');
  }

  const { rows } = await query<CourseRow>(
    `${COURSE_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY c.is_featured DESC, c.rating_sum DESC, c.title`,
    [viewerId],
  );
  return rows.map(mapCourse);
}

/** The in-progress course the Home feed surfaces above the fold. */
export async function getActiveCourse(viewerId: string): Promise<Course | null> {
  const { rows } = await query<CourseRow>(
    `${COURSE_SELECT}
      WHERE c.is_active
        AND e.enrolled_at IS NOT NULL
        AND e.completed_at IS NULL
      ORDER BY e.enrolled_at DESC
      LIMIT 1`,
    [viewerId],
  );
  return rows[0] ? mapCourse(rows[0]) : null;
}

export async function getCourseBySlug(
  slug: string,
  viewerId: string | null,
): Promise<Course | null> {
  const { rows } = await query<CourseRow>(
    `${COURSE_SELECT} WHERE c.slug = $2 AND c.is_active`,
    [viewerId, slug],
  );

  const row = rows[0];
  if (!row) return null;

  const course = mapCourse(row);
  course.days = await getCourseDays(row.id, viewerId, course.enrollment?.daysCompleted ?? 0);
  return course;
}

async function getCourseDays(
  courseId: string,
  viewerId: string | null,
  daysCompleted: number,
): Promise<CourseDay[]> {
  const { rows } = await query<
    SessionRow & { day_number: number; day_title: string; completed_at: Date | null }
  >(
    // The CTE resolves each session once; joining course_days inside it would
    // duplicate any session reused across two days.
    `WITH day_sessions AS (
       ${SESSION_SELECT}
      WHERE s.id IN (SELECT session_id FROM course_days WHERE course_id = $2::uuid)
     )
     SELECT ds.*, cd.day_number, cd.title AS day_title,
            (SELECT max(sc.completed_at)
               FROM session_completions sc
              WHERE sc.user_id = $1::uuid
                AND sc.course_id = $2::uuid
                AND sc.course_day_number = cd.day_number
                AND sc.finished) AS completed_at
       FROM course_days cd
       JOIN day_sessions ds ON ds.id = cd.session_id
      WHERE cd.course_id = $2::uuid
      ORDER BY cd.day_number`,
    [viewerId, courseId],
  );

  return rows.map((row) => ({
    dayNumber: row.day_number,
    title: row.day_title,
    session: mapSession(row),
    // Day 1 is always open; every later day needs the one before it finished.
    isUnlocked: row.day_number <= daysCompleted + 1,
    isCompleted: row.completed_at !== null,
    completedAt: row.completed_at?.toISOString() ?? null,
  }));
}

export async function enroll(userId: string, courseId: string): Promise<void> {
  await query(
    `INSERT INTO course_enrollments (user_id, course_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId],
  );
}

export interface CourseProgressResult {
  daysCompleted: number;
  courseCompleted: boolean;
  certificateUrl: string | null;
}

/**
 * Advances a course after a day is finished. Only advances when the finished
 * day is exactly the next one, so replaying an earlier day cannot rewind
 * progress and skipping ahead cannot inflate it.
 */
export async function recordCourseDay(
  userId: string,
  courseId: string,
  dayNumber: number,
): Promise<CourseProgressResult | null> {
  const { rows } = await query<{
    days_completed: number;
    total_days: number;
    completed_at: Date | null;
    certificate_url: string | null;
  }>(
    `UPDATE course_enrollments e
        SET days_completed = GREATEST(e.days_completed, $3::int),
            completed_at = CASE
              WHEN GREATEST(e.days_completed, $3::int) >= c.total_days AND e.completed_at IS NULL
                THEN now()
              ELSE e.completed_at
            END,
            certificate_url = CASE
              WHEN GREATEST(e.days_completed, $3::int) >= c.total_days AND e.certificate_url IS NULL
                THEN '/certificates/' || e.course_id || '/' || e.user_id
              ELSE e.certificate_url
            END
       FROM courses c
      WHERE e.user_id = $1::uuid
        AND e.course_id = $2::uuid
        AND c.id = e.course_id
        -- Ignore out-of-order days: only the immediate next one advances.
        AND $3::int = e.days_completed + 1
      RETURNING e.days_completed, c.total_days, e.completed_at, e.certificate_url`,
    [userId, courseId, dayNumber],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    daysCompleted: row.days_completed,
    courseCompleted: row.completed_at !== null,
    certificateUrl: row.certificate_url,
  };
}

export { mapCourse, COURSE_SELECT };
