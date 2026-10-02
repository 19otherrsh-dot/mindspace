-- Searching "sleep" returned only sessions with the word in their text, missing
-- the entire Sleepcast catalogue ("Rainforest Canopy", "Harbour Town", …) that
-- users most expect back. Fold the category and format into the search vector
-- so a category name is a usable query.
--
-- The enum→text cast is not IMMUTABLE (labels can be renamed), so Postgres
-- rejects it directly inside an index expression. Wrapping the whole vector in
-- one immutable function fixes that and keeps the query and the index provably
-- in step — they now call the same function rather than repeating an
-- expression that could silently drift apart.

CREATE OR REPLACE FUNCTION session_search_vector(
  p_title       TEXT,
  p_subtitle    TEXT,
  p_description TEXT,
  p_category    content_category,
  p_format      content_format
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(p_subtitle, '')), 'B') ||
         setweight(to_tsvector('english', coalesce(p_description, '')), 'C') ||
         setweight(to_tsvector('english', p_category::text), 'B') ||
         -- 'sleep_music' → 'sleep music', so both words are searchable.
         setweight(to_tsvector('english', replace(p_format::text, '_', ' ')), 'B')
$$;

DROP INDEX sessions_search_idx;

CREATE INDEX sessions_search_idx ON sessions USING GIN (
  session_search_vector(title, subtitle, description, category, format)
);
