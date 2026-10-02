import type {
  Category,
  Collection,
  ContentFormat,
  ExploreQuery,
  Session,
  SortOrder,
  VoicePack,
} from '@mindspace/shared';
import { query } from '../db/pool.ts';

/** Everything selected for a session, including the caller-specific flags. */
export interface SessionRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  category: Category;
  format: ContentFormat;
  duration_seconds: number;
  voice_pack: VoicePack | null;
  artwork_url: string;
  stream_url: string;
  is_pro: boolean;
  play_count: number;
  published_at: Date;
  rating_sum: number;
  rating_count: number;
  instructor_id: string | null;
  instructor_name: string | null;
  instructor_bio: string | null;
  instructor_avatar_url: string | null;
  instructor_tagline: string | null;
  is_favourite: boolean;
  is_downloaded: boolean;
}

/**
 * $1 is always the viewing user's id (or NULL for anonymous browsing), which
 * keeps the favourite/download flags a single join rather than an N+1.
 */
const SESSION_SELECT = `
  SELECT s.id, s.slug, s.title, s.subtitle, s.description, s.category, s.format,
         s.duration_seconds, s.voice_pack, s.artwork_url, s.stream_url, s.is_pro,
         s.play_count, s.published_at, s.rating_sum, s.rating_count,
         i.id   AS instructor_id,
         i.name AS instructor_name,
         i.bio  AS instructor_bio,
         i.avatar_url AS instructor_avatar_url,
         i.tagline AS instructor_tagline,
         (f.user_id IS NOT NULL) AS is_favourite,
         (d.user_id IS NOT NULL) AS is_downloaded
    FROM sessions s
    LEFT JOIN instructors i ON i.id = s.instructor_id
    LEFT JOIN favourites f  ON f.session_id = s.id AND f.user_id = $1::uuid
    LEFT JOIN downloads  d  ON d.session_id = s.id AND d.user_id = $1::uuid
`;

export function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    category: row.category,
    format: row.format,
    durationSeconds: row.duration_seconds,
    voicePack: row.voice_pack,
    instructor: row.instructor_id
      ? {
          id: row.instructor_id,
          name: row.instructor_name ?? '',
          bio: row.instructor_bio ?? '',
          avatarUrl: row.instructor_avatar_url,
          tagline: row.instructor_tagline,
        }
      : null,
    artworkUrl: row.artwork_url,
    streamUrl: row.stream_url,
    isPro: row.is_pro,
    // Guard the divide so an unrated session reads as 0 rather than NaN.
    rating: row.rating_count > 0 ? Number((row.rating_sum / row.rating_count).toFixed(2)) : 0,
    ratingCount: row.rating_count,
    playCount: row.play_count,
    publishedAt: row.published_at.toISOString(),
    isFavourite: row.is_favourite,
    isDownloaded: row.is_downloaded,
  };
}

function orderClause(sort: SortOrder | undefined): string {
  switch (sort) {
    case 'new':
      return 'ORDER BY s.published_at DESC';
    case 'duration':
      return 'ORDER BY s.duration_seconds ASC';
    case 'popular':
    default:
      return 'ORDER BY s.play_count DESC, s.rating_sum DESC';
  }
}

export async function getSessionById(
  sessionId: string,
  viewerId: string | null,
): Promise<Session | null> {
  const { rows } = await query<SessionRow>(
    `${SESSION_SELECT} WHERE s.id = $2::uuid AND s.is_active`,
    [viewerId, sessionId],
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function getSessionsByIds(
  sessionIds: string[],
  viewerId: string | null,
): Promise<Session[]> {
  if (sessionIds.length === 0) return [];
  const { rows } = await query<SessionRow>(
    `${SESSION_SELECT} WHERE s.id = ANY($2::uuid[]) AND s.is_active`,
    [viewerId, sessionIds],
  );
  // Preserve the caller's ordering, which the database does not guarantee.
  const byId = new Map(rows.map((r) => [r.id, mapSession(r)]));
  return sessionIds.map((id) => byId.get(id)).filter((s): s is Session => Boolean(s));
}

export interface SearchResult {
  sessions: Session[];
  total: number;
}

/**
 * Defined in migration 002 and indexed by sessions_search_idx. Calling the same
 * function here is what lets Postgres use that index instead of falling back to
 * a sequential scan.
 */
const SEARCH_VECTOR =
  'session_search_vector(s.title, s.subtitle, s.description, s.category, s.format)';

interface BuiltFilters {
  whereSql: string;
  values: unknown[];
  /** Placeholder holding the search term, when there is one. */
  searchParam: number | null;
  /** First placeholder number still free after the filters. */
  nextParam: number;
}

/**
 * Builds the WHERE clause starting at `startParam`. Postgres rejects bind
 * parameters a statement does not reference, so the list and count queries
 * cannot share one numbering — each calls this with its own starting index.
 */
function buildFilters(params: ExploreQuery, startParam: number): BuiltFilters {
  const where: string[] = ['s.is_active'];
  const values: unknown[] = [];
  let i = startParam;
  let searchParam: number | null = null;

  // Unguided timers are a tool rather than library content, so they stay out
  // of browse and search unless asked for by format explicitly.
  if (params.format !== 'unguided') {
    where.push(`s.format <> 'unguided'`);
  }

  if (params.category) {
    where.push(`s.category = $${i++}::content_category`);
    values.push(params.category);
  }
  if (params.format) {
    where.push(`s.format = $${i++}::content_format`);
    values.push(params.format);
  }
  if (params.freeOnly) {
    where.push('NOT s.is_pro');
  }
  if (params.length === 'short') {
    where.push('s.duration_seconds <= 600');
  } else if (params.length === 'long') {
    where.push('s.duration_seconds > 600');
  }

  const term = params.q?.trim();
  if (term) {
    searchParam = i++;
    where.push(`${SEARCH_VECTOR} @@ plainto_tsquery('english', $${searchParam})`);
    values.push(term);
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, values, searchParam, nextParam: i };
}

/** Backs both the Explore grid and the search bar (screens 7 and 8). */
export async function searchSessions(
  params: ExploreQuery,
  viewerId: string | null,
): Promise<SearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  // List query: $1 is the viewer, so filters begin at $2.
  const list = buildFilters(params, 2);
  const order =
    list.searchParam === null
      ? orderClause(params.sort)
      : // With a search term, relevance beats the chosen sort order.
        `ORDER BY ts_rank(${SEARCH_VECTOR}, plainto_tsquery('english', $${list.searchParam})) DESC,
                  s.play_count DESC`;

  const limitParam = list.nextParam;
  const offsetParam = list.nextParam + 1;

  // Count query: no viewer join, so its filters begin at $1.
  const count = buildFilters(params, 1);

  const [items, total] = await Promise.all([
    query<SessionRow>(
      `${SESSION_SELECT} ${list.whereSql} ${order} LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [viewerId, ...list.values, limit, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total FROM sessions s ${count.whereSql}`,
      count.values,
    ),
  ]);

  return {
    sessions: items.rows.map(mapSession),
    total: total.rows[0]?.total ?? 0,
  };
}

export async function listCollections(featuredOnly = false): Promise<Collection[]> {
  const { rows } = await query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    hero_artwork_url: string;
    accent_color: string;
    category: Category | null;
    session_count: number;
  }>(
    `SELECT c.id, c.slug, c.title, c.description, c.hero_artwork_url, c.accent_color,
            c.category,
            (SELECT count(*)::int FROM collection_sessions cs WHERE cs.collection_id = c.id)
              AS session_count
       FROM collections c
       ${featuredOnly ? 'WHERE c.is_featured' : ''}
      ORDER BY c.sort_order, c.title`,
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    heroArtworkUrl: r.hero_artwork_url,
    accentColor: r.accent_color,
    category: r.category,
    sessionCount: r.session_count,
  }));
}

export async function getCollectionBySlug(
  slug: string,
  viewerId: string | null,
  sort: SortOrder = 'popular',
): Promise<Collection | null> {
  const { rows } = await query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    hero_artwork_url: string;
    accent_color: string;
    category: Category | null;
  }>(
    `SELECT id, slug, title, description, hero_artwork_url, accent_color, category
       FROM collections WHERE slug = $1`,
    [slug],
  );

  const collection = rows[0];
  if (!collection) return null;

  // Curated order is the default; an explicit sort overrides it.
  const order =
    sort === 'popular'
      ? 'ORDER BY cs.position, s.play_count DESC'
      : orderClause(sort);

  const sessions = await query<SessionRow>(
    `${SESSION_SELECT}
      JOIN collection_sessions cs ON cs.session_id = s.id
     WHERE cs.collection_id = $2::uuid AND s.is_active
     ${order}`,
    [viewerId, collection.id],
  );

  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    heroArtworkUrl: collection.hero_artwork_url,
    accentColor: collection.accent_color,
    category: collection.category,
    sessionCount: sessions.rowCount ?? 0,
    sessions: sessions.rows.map(mapSession),
  };
}

/** Sessions in the same category, excluding the one being viewed (screen 9). */
export async function getRelatedSessions(
  sessionId: string,
  category: Category,
  viewerId: string | null,
  limit = 6,
): Promise<Session[]> {
  const { rows } = await query<SessionRow>(
    `${SESSION_SELECT}
     WHERE s.category = $2::content_category AND s.id <> $3::uuid AND s.is_active
     ORDER BY s.play_count DESC
     LIMIT $4`,
    [viewerId, category, sessionId, limit],
  );
  return rows.map(mapSession);
}

export async function incrementPlayCount(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET play_count = play_count + 1 WHERE id = $1::uuid', [sessionId]);
}

export { SESSION_SELECT };
