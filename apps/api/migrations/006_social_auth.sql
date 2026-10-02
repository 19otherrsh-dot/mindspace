-- Sign in with Apple / Google.
--
-- The existing credentials constraint required every non-guest account to have
-- both an email and a password hash. A social account has an email but never a
-- password, so the constraint is widened to accept "authenticates via an
-- external provider" as a third valid state rather than being dropped.
--
-- Written to be safely re-runnable: this shipped briefly as 005_social_auth.sql
-- alongside another 005, and a database that applied it under the old name
-- would otherwise fail here on the rename.

DO $$
BEGIN
  CREATE TYPE auth_provider AS ENUM ('password', 'apple', 'google');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider auth_provider NOT NULL DEFAULT 'password',
  -- The provider's stable user identifier (Apple `sub`, Google `sub`).
  -- Never the email: Apple's private relay addresses can change, the subject
  -- cannot, and matching on email alone would let a provider account takeover
  -- an existing password account.
  ADD COLUMN IF NOT EXISTS provider_subject TEXT;

-- One account per provider identity.
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_identity_idx
  ON users (auth_provider, provider_subject)
  WHERE provider_subject IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_credentials_present;

ALTER TABLE users ADD CONSTRAINT users_credentials_present CHECK (
  is_guest
  OR deleted_at IS NOT NULL
  -- Password accounts need an email and a hash.
  OR (auth_provider = 'password' AND email IS NOT NULL AND password_hash IS NOT NULL)
  -- Social accounts need a provider subject; a password hash is meaningless.
  OR (auth_provider <> 'password' AND provider_subject IS NOT NULL)
);

COMMENT ON COLUMN users.provider_subject IS
  'Stable subject claim from the identity provider. Matched on instead of email.';
