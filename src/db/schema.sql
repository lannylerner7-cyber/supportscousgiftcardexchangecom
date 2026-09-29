-- ScousGiftCardExchange — Cloudflare D1 schema
--
-- SQLite translation of the original Postgres schema.
--  * UUID       -> TEXT (crypto.randomUUID() from the server)
--  * TIMESTAMPTZ-> TEXT, ISO-8601 UTC
--  * BOOLEAN    -> INTEGER 0/1
--  * NUMERIC    -> INTEGER kobo (1 naira = 100 kobo) so balances never drift
--  * ENUM       -> CHECK (col IN (...))
--  * JSONB      -> TEXT holding JSON
-- Row-level policies have no equivalent in D1; every read and write is
-- authorised in the server code (see src/lib/guard.server.ts).

PRAGMA foreign_keys = ON;

-- ============================================================ accounts

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  email_confirmed_at  TEXT,
  last_sign_in_at     TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS profiles (
  id                    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name             TEXT NOT NULL DEFAULT '',
  email                 TEXT NOT NULL,
  phone                 TEXT,
  avatar_url            TEXT,
  admin_code            TEXT,
  is_verified           INTEGER NOT NULL DEFAULT 0,
  hide_balance_default  INTEGER NOT NULL DEFAULT 0,
  sound_enabled         INTEGER NOT NULL DEFAULT 1,
  push_enabled          INTEGER NOT NULL DEFAULT 1,
  withdrawal_pin_hash   TEXT,
  pin_attempts          INTEGER NOT NULL DEFAULT 0,
  pin_locked_until      TEXT,
  frozen_at             TEXT,
  frozen_reason         TEXT,
  referral_code         TEXT,
  referred_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(full_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral ON profiles(referral_code);

CREATE TABLE IF NOT EXISTS user_roles (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_lookup ON user_roles(user_id, role);

-- ============================================================ catalogue

CREATE TABLE IF NOT EXISTS gift_card_brands (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  logo_url      TEXT,
  accent_color  TEXT,
  is_visible    INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brands_visible ON gift_card_brands(is_visible, sort_order);
CREATE INDEX IF NOT EXISTS idx_brands_name ON gift_card_brands(name);

CREATE TABLE IF NOT EXISTS gift_card_regions (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  flag_emoji  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_regions_active ON gift_card_regions(is_active, sort_order);

CREATE TABLE IF NOT EXISTS gift_card_variants (
  id          TEXT PRIMARY KEY,
  brand_id    TEXT NOT NULL REFERENCES gift_card_brands(id) ON DELETE CASCADE,
  region_id   TEXT NOT NULL REFERENCES gift_card_regions(id) ON DELETE CASCADE,
  card_type   TEXT NOT NULL CHECK (card_type IN ('physical','ecode')),
  min_value   INTEGER NOT NULL DEFAULT 0,
  max_value   INTEGER NOT NULL DEFAULT 0,
  rate_naira  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_lookup ON gift_card_variants(brand_id, region_id, card_type);
CREATE INDEX IF NOT EXISTS idx_variants_active ON gift_card_variants(is_active);
CREATE INDEX IF NOT EXISTS idx_variants_region ON gift_card_variants(region_id);

-- ============================================================ trading

CREATE TABLE IF NOT EXISTS trades (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id          TEXT REFERENCES gift_card_brands(id) ON DELETE SET NULL,
  region_id         TEXT REFERENCES gift_card_regions(id) ON DELETE SET NULL,
  variant_id        TEXT REFERENCES gift_card_variants(id) ON DELETE SET NULL,
  brand_name        TEXT NOT NULL,
  region_code       TEXT NOT NULL,
  card_type         TEXT NOT NULL CHECK (card_type IN ('physical','ecode')),
  face_value        INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  rate_at_submit    INTEGER NOT NULL,
  expected_payout   INTEGER NOT NULL,
  paid_amount       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','successful','partially_paid','used','error')),
  admin_note        TEXT,
  user_note         TEXT,
  flagged_duplicate INTEGER NOT NULL DEFAULT 0,
  ecode             TEXT,
  ecode_pin         TEXT,
  reviewed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_reviewer ON trades(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_ecode ON trades(ecode);

CREATE TABLE IF NOT EXISTS trade_images (
  id            TEXT PRIMARY KEY,
  trade_id      TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'front',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_images_trade ON trade_images(trade_id);

-- ============================================================ money

CREATE TABLE IF NOT EXISTS wallets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_naira INTEGER NOT NULL DEFAULT 0,
  held_naira    INTEGER NOT NULL DEFAULT 0,
  locked_naira  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              TEXT PRIMARY KEY,
  wallet_id       TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('credit','debit','hold','release','fee')),
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reference_type  TEXT,
  reference_id    TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_ref ON wallet_transactions(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS banks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT,
  is_digital  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_banks_active ON banks(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_banks_name ON banks(name);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_id         TEXT REFERENCES banks(id) ON DELETE SET NULL,
  bank_name       TEXT NOT NULL,
  bank_code       TEXT,
  account_number  TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id, is_default DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_account_id  TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  bank_snapshot    TEXT,
  amount           INTEGER NOT NULL,
  fee              INTEGER NOT NULL DEFAULT 30000,
  net_amount       INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','approved','cancelled','paid')),
  admin_note       TEXT,
  processed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  processed_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);

-- ============================================================ messaging

CREATE TABLE IF NOT EXISTS chat_threads (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id          TEXT REFERENCES trades(id) ON DELETE SET NULL,
  last_message_at   TEXT NOT NULL,
  unread_for_admin  INTEGER NOT NULL DEFAULT 0,
  unread_for_user   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_recent ON chat_threads(last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role  TEXT NOT NULL DEFAULT 'user' CHECK (sender_role IN ('admin','user')),
  body         TEXT,
  image_path   TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT NOT NULL DEFAULT 'info',
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_recent ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_recent ON contact_messages(created_at DESC);

-- ============================================================ security

CREATE TABLE IF NOT EXISTS otp_codes (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('signup','login','reset','pin')),
  code_hash     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  resend_count  INTEGER NOT NULL DEFAULT 0,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_lookup ON otp_codes(email, purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_open ON otp_codes(email, purpose, consumed_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  ip            TEXT,
  succeeded     INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  before       TEXT,
  after        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_log(actor_id, created_at DESC);

-- ============================================================ site content

CREATE TABLE IF NOT EXISTS campaign_banners (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  subtitle    TEXT,
  image_url   TEXT,
  link        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  starts_at   TEXT,
  ends_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_banners_active ON campaign_banners(is_active, sort_order);

CREATE TABLE IF NOT EXISTS smtp_settings (
  id           TEXT PRIMARY KEY,
  host         TEXT,
  port         INTEGER DEFAULT 587,
  username     TEXT,
  secure       INTEGER NOT NULL DEFAULT 1,
  from_name    TEXT DEFAULT 'ScousGiftCardExchange',
  from_email   TEXT,
  use_builtin  INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  alert_emails  TEXT NOT NULL DEFAULT '[]',
  from_name     TEXT NOT NULL DEFAULT 'ScousGiftCardExchange',
  reply_to      TEXT,
  updated_at    TEXT NOT NULL
);
