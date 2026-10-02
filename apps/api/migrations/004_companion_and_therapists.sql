-- Two features from the competitor analysis's open-decisions list:
--
-- 1. An AI companion (Headspace ships "Ebb"). Conversation content is
--    self-reported mental-health data, so message bodies are encrypted at rest
--    with the same AES-256-GCM treatment as mood notes (PRD §5.2).
--
-- 2. Licensed therapists with real scheduling. Clinicians are licensed per
--    jurisdiction, so the schema models licences explicitly and a booking is
--    refused when the therapist does not hold a licence covering the client.

/* ------------------------------------------------------------------ */
/* AI companion                                                        */
/* ------------------------------------------------------------------ */

CREATE TYPE companion_role AS ENUM ('user', 'assistant');

/**
 * Risk level assigned to an inbound message by the safety classifier.
 * `crisis` short-circuits the model entirely — see src/llm/safety.ts.
 */
CREATE TYPE companion_risk AS ENUM ('none', 'elevated', 'crisis');

CREATE TABLE companion_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

CREATE INDEX companion_conversations_user_idx
  ON companion_conversations (user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE companion_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES companion_conversations(id) ON DELETE CASCADE,
  role            companion_role NOT NULL,
  -- Sealed by the application before insert; never stored as plaintext.
  content_encrypted BYTEA NOT NULL,
  risk            companion_risk NOT NULL DEFAULT 'none',
  -- Which provider/model produced an assistant turn, for auditability when
  -- the deployment swaps providers mid-life.
  provider        TEXT,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX companion_messages_conversation_idx
  ON companion_messages (conversation_id, created_at);

/**
 * Every crisis classification is recorded separately from the conversation so
 * it survives the user deleting the thread, and so safety review never
 * requires decrypting message bodies.
 */
CREATE TABLE companion_safety_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES companion_conversations(id) ON DELETE SET NULL,
  risk            companion_risk NOT NULL,
  -- The rule that fired, e.g. 'self_harm'. Never the message text.
  category        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX companion_safety_events_user_idx
  ON companion_safety_events (user_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* Therapists                                                          */
/* ------------------------------------------------------------------ */

CREATE TYPE appointment_status AS ENUM (
  'scheduled', 'completed', 'cancelled_by_client', 'cancelled_by_therapist', 'no_show'
);

CREATE TABLE therapists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  -- Post-nominals shown next to the name, e.g. "PsyD, LCSW".
  credentials   TEXT NOT NULL,
  headline      TEXT NOT NULL,
  bio           TEXT NOT NULL,
  avatar_url    TEXT,
  -- IANA zone the therapist's availability windows are expressed in.
  timezone      TEXT NOT NULL,
  languages     TEXT[] NOT NULL DEFAULT '{en}',
  specialties   TEXT[] NOT NULL DEFAULT '{}',
  -- Cents, in the therapist's billing currency.
  session_price_cents INTEGER NOT NULL CHECK (session_price_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  session_minutes SMALLINT NOT NULL DEFAULT 50 CHECK (session_minutes BETWEEN 15 AND 180),
  -- Minimum notice before a slot can be booked.
  min_notice_hours SMALLINT NOT NULL DEFAULT 12,
  accepting_clients BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX therapists_available_idx
  ON therapists (full_name)
  WHERE is_active AND accepting_clients;

/**
 * A clinician may only see clients in jurisdictions where they hold a licence.
 * Enforced at booking time, not merely displayed.
 */
CREATE TABLE therapist_licences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id  UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  -- ISO 3166-1 alpha-2, optionally with a subdivision: "US-CA", "GB".
  jurisdiction  TEXT NOT NULL,
  licence_body  TEXT NOT NULL,
  licence_number TEXT NOT NULL,
  expires_on    DATE,
  UNIQUE (therapist_id, jurisdiction, licence_number)
);

CREATE INDEX therapist_licences_jurisdiction_idx ON therapist_licences (jurisdiction);

/** Recurring weekly availability, in the therapist's own timezone. */
CREATE TABLE therapist_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id  UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday.
  weekday       SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  CONSTRAINT availability_window_ordered CHECK (end_time > start_time)
);

CREATE INDEX therapist_availability_idx ON therapist_availability (therapist_id, weekday);

/** One-off blocks: holidays, conferences, personal leave. */
CREATE TABLE therapist_time_off (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id  UUID NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  reason        TEXT,
  CONSTRAINT time_off_ordered CHECK (ends_at > starts_at)
);

CREATE INDEX therapist_time_off_idx ON therapist_time_off (therapist_id, starts_at);

CREATE TABLE appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id  UUID NOT NULL REFERENCES therapists(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        appointment_status NOT NULL DEFAULT 'scheduled',
  -- Jitsi Meet room; open source and self-hostable, no per-user account needed.
  video_room    TEXT NOT NULL,
  -- What the client wants to work on, encrypted like all health content.
  note_encrypted BYTEA,
  -- The jurisdiction the booking was authorised under, captured at booking
  -- time so a later licence change cannot rewrite history.
  jurisdiction  TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appointment_ordered CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_user_idx ON appointments (user_id, starts_at DESC);
CREATE INDEX appointments_therapist_idx ON appointments (therapist_id, starts_at);

/**
 * Double-booking is a correctness problem, not a UX one: two clients holding
 * the same slot is unrecoverable. A partial unique index on the start instant
 * makes the race impossible regardless of how many API instances are running.
 */
CREATE UNIQUE INDEX appointments_no_double_booking
  ON appointments (therapist_id, starts_at)
  WHERE status = 'scheduled';
