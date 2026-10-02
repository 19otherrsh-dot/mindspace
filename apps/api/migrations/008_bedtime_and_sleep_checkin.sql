-- A second reminder channel, and sleep as a tracked dimension.
--
-- One reminder a day gives a single chance to be caught at a good moment.
-- Bedtime is a different habit from the morning sit, and it is when the sleep
-- content we already publish is actually wanted.
--
-- Sleep quality is asked about during onboarding and never measured again, so
-- neither the user nor we can tell whether any of it is helping.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS bedtime_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Local wall-clock time, like reminder_time. Off by default: an unrequested
  -- notification at 22:00 is an intrusion, not a feature.
  ADD COLUMN IF NOT EXISTS bedtime_time TIME NOT NULL DEFAULT '22:00';

-- Sleep check-ins. Separate from mood_entries because the cadence differs —
-- mood is captured around sessions, sleep is reported once for the night
-- before — and because one row per night is the natural key.
CREATE TABLE IF NOT EXISTS sleep_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The night being reported on, in the user's local timezone.
  night_date    DATE NOT NULL,
  -- 1 = slept badly … 5 = slept well. Matches the mood scale so the two
  -- trends can be charted against each other.
  quality       SMALLINT NOT NULL CHECK (quality BETWEEN 1 AND 5),
  -- Encrypted like mood notes: how someone slept is health information.
  note_ciphertext BYTEA,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One reading per night; a second submission corrects the first.
  UNIQUE (user_id, night_date)
);

CREATE INDEX IF NOT EXISTS sleep_entries_user_night_idx
  ON sleep_entries (user_id, night_date DESC);

COMMENT ON TABLE sleep_entries IS
  'Nightly sleep quality, so the effect of sleep content is measurable rather than assumed.';
