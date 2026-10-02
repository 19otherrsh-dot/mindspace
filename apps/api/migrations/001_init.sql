-- Mindspace initial schema.
-- Covers users & auth, the content library, courses, and all activity data
-- (completions, mood, streaks, achievements) described in the PRD.

/* ------------------------------------------------------------------ */
/* Extensions                                                          */
/* ------------------------------------------------------------------ */

-- Case-insensitive email comparison, so Ada@x.com and ada@x.com are one account.
CREATE EXTENSION IF NOT EXISTS citext;

/* ------------------------------------------------------------------ */
/* Enumerated domains                                                  */
/* ------------------------------------------------------------------ */

CREATE TYPE subscription_tier AS ENUM ('free', 'pro_monthly', 'pro_annual', 'teams');

CREATE TYPE content_category AS ENUM (
  'stress', 'anxiety', 'sleep', 'focus', 'relationships', 'sports', 'beginners'
);

CREATE TYPE content_format AS ENUM (
  'meditation', 'sleepcast', 'sleep_music', 'focus_music', 'mini', 'movement', 'wind_down'
);

CREATE TYPE voice_pack AS ENUM ('calm', 'warm', 'neutral');
CREATE TYPE mood_context AS ENUM ('pre_session', 'post_session', 'standalone');
CREATE TYPE experience_level AS ENUM ('new', 'some', 'experienced');
CREATE TYPE sleep_quality AS ENUM ('poor', 'fair', 'good');
CREATE TYPE audio_quality AS ENUM ('standard', 'high');
CREATE TYPE theme_preference AS ENUM ('system', 'light', 'dark');
CREATE TYPE time_of_day AS ENUM ('morning', 'afternoon', 'evening', 'flexible');

/* ------------------------------------------------------------------ */
/* Users & auth                                                        */
/* ------------------------------------------------------------------ */

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Guests have no email until they convert, so this is nullable but unique.
  email               CITEXT UNIQUE,
  password_hash       TEXT,
  display_name        TEXT NOT NULL,
  avatar_url          TEXT,
  is_guest            BOOLEAN NOT NULL DEFAULT FALSE,
  -- IANA zone. Streaks and the "today" boundary are computed in this zone,
  -- never in the server's, so a user in Auckland does not lose a day.
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  subscription_tier   subscription_tier NOT NULL DEFAULT 'free',
  subscription_renews_at TIMESTAMPTZ,
  trial_ends_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set by the GDPR/CCPA deletion flow; rows are purged by a nightly job.
  deleted_at          TIMESTAMPTZ,

  -- A live non-guest account must be able to authenticate. Erasure scrubs the
  -- credentials, so deleted rows are exempt.
  CONSTRAINT users_credentials_present CHECK (
    is_guest
    OR deleted_at IS NOT NULL
    OR (email IS NOT NULL AND password_hash IS NOT NULL)
  )
);

CREATE INDEX users_active_idx ON users (id) WHERE deleted_at IS NULL;

CREATE TABLE user_preferences (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reminder_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_time            TIME NOT NULL DEFAULT '08:00',
  -- ISO weekday numbers, 0 = Sunday. Empty array means every day.
  reminder_days            SMALLINT[] NOT NULL DEFAULT '{}',
  reminder_message         TEXT NOT NULL DEFAULT 'Time to find your calm.',
  background_sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  audio_quality            audio_quality NOT NULL DEFAULT 'standard',
  theme                    theme_preference NOT NULL DEFAULT 'system',
  preferred_voice_pack     voice_pack NOT NULL DEFAULT 'calm',
  download_over_cellular   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lets the reminder scheduler sweep "who is due in this minute" cheaply.
CREATE INDEX user_preferences_reminder_idx
  ON user_preferences (reminder_time)
  WHERE reminder_enabled;

CREATE TABLE onboarding_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goals               content_category[] NOT NULL DEFAULT '{}',
  experience_level    experience_level NOT NULL,
  sleep_quality       sleep_quality NOT NULL,
  daily_minutes       SMALLINT NOT NULL CHECK (daily_minutes BETWEEN 1 AND 120),
  preferred_time      time_of_day NOT NULL DEFAULT 'flexible',
  completed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the token; the raw value never touches the database.
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

/* ------------------------------------------------------------------ */
/* Content library                                                     */
/* ------------------------------------------------------------------ */

CREATE TABLE instructors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  bio        TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  subtitle         TEXT,
  description      TEXT NOT NULL DEFAULT '',
  category         content_category NOT NULL,
  format           content_format NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  voice_pack       voice_pack,
  instructor_id    UUID REFERENCES instructors(id) ON DELETE SET NULL,
  artwork_url      TEXT NOT NULL,
  -- HLS manifest on the CDN (PRD §5.1).
  stream_url       TEXT NOT NULL,
  is_pro           BOOLEAN NOT NULL DEFAULT TRUE,
  play_count       INTEGER NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lets editorial pull a session without breaking users' history.
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- Maintained by trigger from session_ratings so list queries never aggregate.
  rating_sum       INTEGER NOT NULL DEFAULT 0,
  rating_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_category_idx ON sessions (category) WHERE is_active;
CREATE INDEX sessions_format_idx ON sessions (format) WHERE is_active;
CREATE INDEX sessions_free_idx ON sessions (is_pro) WHERE is_active AND NOT is_pro;
CREATE INDEX sessions_popular_idx ON sessions (play_count DESC) WHERE is_active;
CREATE INDEX sessions_published_idx ON sessions (published_at DESC) WHERE is_active;

-- Backs the Explore search bar. Title is weighted above description.
CREATE INDEX sessions_search_idx ON sessions USING GIN (
  (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('english', description), 'C')
  )
);

CREATE TABLE collections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  hero_artwork_url  TEXT NOT NULL,
  accent_color      TEXT NOT NULL DEFAULT '#5B7FFF',
  category          content_category,
  is_featured       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection_sessions (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, session_id)
);

CREATE INDEX collection_sessions_order_idx ON collection_sessions (collection_id, position);

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

CREATE TABLE courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  artwork_url   TEXT NOT NULL,
  accent_color  TEXT NOT NULL DEFAULT '#5B7FFF',
  instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL,
  total_days    SMALLINT NOT NULL CHECK (total_days > 0),
  is_pro        BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  rating_sum    INTEGER NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_days (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day_number SMALLINT NOT NULL CHECK (day_number > 0),
  title      TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  PRIMARY KEY (course_id, day_number)
);

CREATE TABLE course_enrollments (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Highest contiguous day finished; 0 means enrolled but not started.
  days_completed  SMALLINT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  certificate_url TEXT,
  PRIMARY KEY (user_id, course_id)
);

CREATE INDEX course_enrollments_in_progress_idx
  ON course_enrollments (user_id, enrolled_at DESC)
  WHERE completed_at IS NULL;

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE session_completions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  started_at        TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  seconds_listened  INTEGER NOT NULL CHECK (seconds_listened >= 0),
  -- False when the user ended early; those still count toward minutes but
  -- not toward course progression.
  finished          BOOLEAN NOT NULL DEFAULT TRUE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  course_day_number SMALLINT,
  -- Calendar day in the user's timezone, resolved at write time. Streak and
  -- heatmap queries group on this instead of re-deriving the zone every read.
  activity_date     DATE NOT NULL
);

CREATE INDEX session_completions_user_date_idx
  ON session_completions (user_id, activity_date DESC);
CREATE INDEX session_completions_user_recent_idx
  ON session_completions (user_id, completed_at DESC);
CREATE INDEX session_completions_course_idx
  ON session_completions (user_id, course_id)
  WHERE course_id IS NOT NULL;

CREATE TABLE mood_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value        SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 5),
  context      mood_context NOT NULL DEFAULT 'standalone',
  -- Free-text notes are health data, so they are AES-256-GCM sealed by the
  -- application before they reach this column (PRD §5.2).
  note_encrypted BYTEA,
  session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activity_date DATE NOT NULL
);

CREATE INDEX mood_entries_user_date_idx ON mood_entries (user_id, activity_date DESC);

CREATE TABLE favourites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE downloads (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Size the client reported storing, used for the storage row in Settings.
  bytes        BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE session_ratings (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

CREATE TABLE achievements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  -- What the threshold counts against.
  metric      TEXT NOT NULL CHECK (metric IN ('streak', 'total_sessions', 'total_minutes', 'courses_completed')),
  threshold   INTEGER NOT NULL CHECK (threshold > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_achievements (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier          subscription_tier NOT NULL,
  store         TEXT NOT NULL CHECK (store IN ('apple', 'google', 'web', 'manual')),
  -- Opaque receipt/transaction id from the store, used for renewal webhooks.
  receipt_ref   TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at     TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, started_at DESC);
CREATE UNIQUE INDEX subscriptions_receipt_idx ON subscriptions (store, receipt_ref);

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

-- Keep sessions.rating_sum / rating_count in step with session_ratings so the
-- library list endpoints never have to aggregate at read time.
CREATE OR REPLACE FUNCTION sync_session_rating() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE sessions
       SET rating_sum = rating_sum + NEW.rating,
           rating_count = rating_count + 1
     WHERE id = NEW.session_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE sessions
       SET rating_sum = rating_sum - OLD.rating + NEW.rating
     WHERE id = NEW.session_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE sessions
       SET rating_sum = rating_sum - OLD.rating,
           rating_count = rating_count - 1
     WHERE id = OLD.session_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_ratings_sync
AFTER INSERT OR UPDATE OR DELETE ON session_ratings
FOR EACH ROW EXECUTE FUNCTION sync_session_rating();

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON user_preferences
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
