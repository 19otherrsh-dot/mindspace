CREATE TABLE push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_tokens_user_idx ON push_tokens(user_id) WHERE is_active;

CREATE TABLE push_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     TEXT NOT NULL UNIQUE,
  push_token    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX push_tickets_pending_idx ON push_tickets(status) WHERE status = 'pending';

CREATE TRIGGER push_tokens_touch BEFORE UPDATE ON push_tokens
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
