-- Competitive gaps closed here (see docs/competitor-analysis.md):
--
-- 1. Unguided timer meditation. Calm offers a plain timer with interval bells
--    and no narration; Mindspace had no way to sit without a guide. Rather than
--    making session_completions.session_id nullable — which would complicate
--    every stats query — a timer is modelled as a real session with no audio.
--    Streaks, history and achievements then work with no special-casing.
--
-- 2. Narrator billing. Calm leads with who is reading ("with Matthew
--    McConaughey"), and there was no way to feature a teacher or browse by one.

ALTER TYPE content_format ADD VALUE IF NOT EXISTS 'unguided';

ALTER TABLE instructors
  ADD COLUMN tagline     TEXT,
  ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN instructors.tagline IS
  'Short billing line shown under the name, e.g. "Former ER nurse".';

CREATE INDEX instructors_featured_idx
  ON instructors (sort_order, name)
  WHERE is_featured;
