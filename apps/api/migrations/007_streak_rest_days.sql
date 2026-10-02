-- Streak insurance.
--
-- Cancellation in this category typically follows a lost streak, and Mindspace
-- gamifies streaks heavily with no forgiveness anywhere in it — so a single
-- missed day can undo months of practice. A rest day bridges one missed day so
-- the run survives.
--
-- Each row is a rest day that has been *spent* on a specific date. Recording
-- the spend (rather than recomputing forgiveness on every read) is what stops
-- the same gap being forgiven repeatedly, which would make the streak
-- meaningless.

CREATE TABLE IF NOT EXISTS streak_rest_days (
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The missed day this rest day covers, in the user's local timezone.
  rest_date   DATE NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One rest day per date: the unique key is what makes applying protection
  -- idempotent, so a replayed completion cannot spend the allowance twice.
  PRIMARY KEY (user_id, rest_date)
);

-- The allowance check counts a user's spends within a calendar month, and the
-- streak read needs every protected date; both are covered by this ordering.
CREATE INDEX IF NOT EXISTS streak_rest_days_user_date_idx
  ON streak_rest_days (user_id, rest_date DESC);

COMMENT ON TABLE streak_rest_days IS
  'Days where a missed session was forgiven so the streak continued. One row per forgiven day.';
