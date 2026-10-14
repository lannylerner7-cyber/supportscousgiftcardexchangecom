-- Additive, operator-applied migration. Never execute from a login request.
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  credential_tag TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS passkey_owner ON passkey_credentials(user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('register','login')),
  user_id TEXT,
  session_id TEXT,
  credential_tag TEXT,
  remember INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed TEXT
);
CREATE INDEX IF NOT EXISTS passkey_expiry ON passkey_challenges(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS passkey_challenge_hash ON passkey_challenges(challenge_hash);
CREATE TABLE IF NOT EXISTS passkey_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES passkey_credentials(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS passkey_session_credential ON passkey_sessions(credential_id);
CREATE TABLE IF NOT EXISTS passkey_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passkey_limit_window ON passkey_limits(window);
