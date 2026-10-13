-- Additive, idempotent migration. Apply explicitly before deploying the new auth code.
-- Do NOT backfill verified sessions: old sessions did not prove server-side OTP.
CREATE TABLE IF NOT EXISTS session_security (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 0,
  remember INTEGER NOT NULL DEFAULT 0,
  purpose TEXT NOT NULL,
  credential_tag TEXT NOT NULL,
  challenge_id TEXT
);
CREATE TABLE IF NOT EXISTS trusted_devices (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_tag TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
