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
-- ============================================================ attached gift-card market
-- Owner-supplied catalogue. New cards start hidden and unpriced until the desk sets a live rate.

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_wayfair','Wayfair','wayfair','/__l5e/assets-v1/d3706e4a-4023-4c0e-b5c7-e0ea839968db/wayfair.png',NULL,0,100,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_wayfair_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='wayfair' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_wayfair_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='wayfair' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_ulta-beauty','Ulta Beauty','ulta-beauty','/__l5e/assets-v1/b9a80037-7e5b-4141-9976-984ad033b9b3/ulta-beauty.png',NULL,0,101,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_ulta-beauty_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='ulta-beauty' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_ulta-beauty_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='ulta-beauty' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_twitch','Twitch','twitch','/__l5e/assets-v1/e08b08ac-fb0a-481f-b6da-4496e40e7d2b/twitch.png',NULL,0,102,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_twitch_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='twitch' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_twitch_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='twitch' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_subway','Subway','subway','/__l5e/assets-v1/04852c19-23b7-4eef-b9dc-2e6f64066b94/subway.jpg',NULL,0,103,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_subway_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='subway' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_subway_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='subway' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_kfc','KFC','kfc','/__l5e/assets-v1/d180aaa6-5d28-4b89-a139-bce175d26d76/kfc.jpg',NULL,0,104,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_kfc_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='kfc' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_kfc_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='kfc' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_southwest-airlines','Southwest Airlines','southwest-airlines','/__l5e/assets-v1/473ffe31-1df2-43c2-a028-df9431509882/southwest-airlines.jpg',NULL,0,105,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_southwest-airlines_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='southwest-airlines' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_southwest-airlines_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='southwest-airlines' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_sam-s-club','Sam''s Club','sam-s-club','/__l5e/assets-v1/792a2c13-7663-44a8-a23c-84db37cd58c4/sam-s-club.png',NULL,0,106,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_sam-s-club_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='sam-s-club' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_sam-s-club_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='sam-s-club' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_roblox','Roblox','roblox','/__l5e/assets-v1/d2c71102-e53b-4db8-8c86-7538462ff976/roblox.png',NULL,0,107,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_roblox_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='roblox' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_roblox_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='roblox' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_rei','REI','rei','/__l5e/assets-v1/2e4f17c6-e61f-4c38-8898-619e8c6a9924/rei.jpg',NULL,0,108,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_rei_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='rei' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_rei_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='rei' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_papa-murphy-s','Papa Murphy''s','papa-murphy-s','/__l5e/assets-v1/dcc2da28-10e1-4872-b070-0076849a16ad/papa-murphy-s.jpg',NULL,0,109,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_papa-murphy-s_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='papa-murphy-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_papa-murphy-s_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='papa-murphy-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_paramount','Paramount+','paramount','/__l5e/assets-v1/8ce6f209-b1e8-4c43-a9e7-f1bf056f2cc7/paramount.png',NULL,0,110,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_paramount_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='paramount' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_paramount_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='paramount' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_panda-express','Panda Express','panda-express','/__l5e/assets-v1/47239213-b2e5-4216-a10e-4d3d858788dc/panda-express.png',NULL,0,111,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_panda-express_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='panda-express' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_panda-express_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='panda-express' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_old-navy','Old Navy','old-navy','/__l5e/assets-v1/95897fe1-3108-49c2-ad36-80b3dcf9caf1/old-navy.png',NULL,0,112,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_old-navy_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='old-navy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_old-navy_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='old-navy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_microsoft-365-personal','Microsoft 365 Personal','microsoft-365-personal','/__l5e/assets-v1/2f62d8e7-dc17-4352-bd21-2248b76a03cc/microsoft-365-personal.png',NULL,0,113,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_microsoft-365-personal_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='microsoft-365-personal' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_microsoft-365-personal_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='microsoft-365-personal' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_meta-quest','Meta Quest','meta-quest','/__l5e/assets-v1/20815313-b921-4b7e-b61b-884857cc9b43/meta-quest.png',NULL,0,114,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_meta-quest_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='meta-quest' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_meta-quest_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='meta-quest' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_lyft','Lyft','lyft','/__l5e/assets-v1/67cdf504-403a-45e6-a405-5e20e68abdde/lyft.png',NULL,0,115,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_lyft_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='lyft' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_lyft_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='lyft' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_kohl-s','Kohl''s','kohl-s','/__l5e/assets-v1/2d97c98c-3084-4f87-a20a-a95adf1d4862/kohl-s.png',NULL,0,116,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_kohl-s_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='kohl-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_kohl-s_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='kohl-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_jcpenney','JCPenney','jcpenney','/__l5e/assets-v1/12ec7345-5de9-4dfc-8156-39770836edda/jcpenney.jpg',NULL,0,117,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_jcpenney_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='jcpenney' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_jcpenney_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='jcpenney' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_instacart','Instacart','instacart','/__l5e/assets-v1/a43be3c0-61f5-4aa8-b3c5-6516780cfa1e/instacart.jpg',NULL,0,118,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_instacart_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='instacart' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_instacart_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='instacart' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_ikea','IKEA','ikea','/__l5e/assets-v1/9ea56ad2-85a6-4f3d-aaa4-ced9eaaa66db/ikea.jpg',NULL,0,119,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_ikea_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='ikea' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_ikea_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='ikea' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_hulu','Hulu','hulu','/__l5e/assets-v1/f4a3304c-7d6c-418f-bb23-c7381c0db253/hulu.jpg',NULL,0,120,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_hulu_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='hulu' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_hulu_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='hulu' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_hotels-com','Hotels.com','hotels-com','/__l5e/assets-v1/8eb8b815-5a1b-418e-adb2-c48b97ba2429/hotels-com.png',NULL,0,121,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_hotels-com_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='hotels-com' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_hotels-com_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='hotels-com' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_the-home-depot','The Home Depot','the-home-depot','/__l5e/assets-v1/860987bb-0408-499f-a000-318f1da6edf2/the-home-depot.jpg',NULL,0,122,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_the-home-depot_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='the-home-depot' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_the-home-depot_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='the-home-depot' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_h-m','H&M','h-m','/__l5e/assets-v1/8a75212d-4962-4262-86f8-ea46ad882acb/h-m.png',NULL,0,123,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_h-m_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='h-m' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_h-m_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='h-m' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_google-workspace','Google Workspace','google-workspace','/__l5e/assets-v1/2da1aa36-6c9a-44bd-b559-02181e35c4b5/google-workspace.png',NULL,0,124,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_google-workspace_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='google-workspace' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_google-workspace_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='google-workspace' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_gap','Gap','gap','/__l5e/assets-v1/b02e437b-8f36-4855-a548-0b9601a84286/gap.png',NULL,0,125,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_gap_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='gap' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_gap_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='gap' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_gamestop','GameStop','gamestop','/__l5e/assets-v1/25545755-8975-4cc2-8f23-d1d8d5fb03b1/gamestop.jpg',NULL,0,126,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_gamestop_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='gamestop' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_gamestop_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='gamestop' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_etsy','Etsy','etsy','/__l5e/assets-v1/dce9b180-30dd-4bf2-a989-6837493416ac/etsy.png',NULL,0,127,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_etsy_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='etsy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_etsy_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='etsy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_domino-s','Domino''s','domino-s','/__l5e/assets-v1/6e95ccc4-5371-4b92-9c87-3d004eac4b9a/domino-s.png',NULL,0,128,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_domino-s_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='domino-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_domino-s_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='domino-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_disney','Disney','disney','/__l5e/assets-v1/441c5a04-bfed-49b3-8ff9-9aa9506de169/disney.png',NULL,0,129,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_disney_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='disney' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_disney_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='disney' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_delta-air-lines','Delta Air Lines','delta-air-lines','/__l5e/assets-v1/f3141afd-82c4-4bf7-8702-1846c238d4dc/delta-air-lines.png',NULL,0,130,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_delta-air-lines_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='delta-air-lines' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_delta-air-lines_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='delta-air-lines' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_cvs-pharmacy','CVS Pharmacy','cvs-pharmacy','/__l5e/assets-v1/99183d8b-6fc4-44d9-989a-c9136c42c2ed/cvs-pharmacy.png',NULL,0,131,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_cvs-pharmacy_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='cvs-pharmacy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_cvs-pharmacy_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='cvs-pharmacy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_chewy','Chewy','chewy','/__l5e/assets-v1/faae1d6c-47b9-400d-89e5-4d5f06fd0bcc/chewy.png',NULL,0,132,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_chewy_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='chewy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_chewy_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='chewy' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_belk','Belk','belk','/__l5e/assets-v1/73473245-482e-4b5d-a85e-30604ca38ea9/belk.jpg',NULL,0,133,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_belk_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='belk' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_belk_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='belk' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_bass-pro-shops','Bass Pro Shops','bass-pro-shops','/__l5e/assets-v1/88441a96-9886-4dfc-9494-b3b51985047e/bass-pro-shops.png',NULL,0,134,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_bass-pro-shops_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='bass-pro-shops' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_bass-pro-shops_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='bass-pro-shops' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_baby-gap','Baby Gap','baby-gap','/__l5e/assets-v1/26a68aba-392a-464c-961e-5675645aebb3/baby-gap.png',NULL,0,135,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_baby-gap_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='baby-gap' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_baby-gap_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='baby-gap' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_applebee-s','Applebee''s','applebee-s','/__l5e/assets-v1/0c33c9ed-5baf-481f-90ff-d6f445aaafe1/applebee-s.png',NULL,0,136,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_applebee-s_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='applebee-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_applebee-s_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='applebee-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_amtrak','Amtrak','amtrak','/__l5e/assets-v1/d7c6c51e-ea94-4440-a339-a9e676fac174/amtrak.png',NULL,0,137,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_amtrak_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='amtrak' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_amtrak_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='amtrak' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_airbnb','Airbnb','airbnb','/__l5e/assets-v1/a540efce-9b4c-48be-b08e-d0373ac5d7c7/airbnb.jpg',NULL,0,138,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_airbnb_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='airbnb' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_airbnb_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='airbnb' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_adidas','Adidas','adidas','/__l5e/assets-v1/e85a928d-40f4-47e4-8edf-5eabb6f3c784/adidas.png',NULL,0,139,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_adidas_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='adidas' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_adidas_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='adidas' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_microsoft-365-business-standard','Microsoft 365 Business Standard','microsoft-365-business-standard','/__l5e/assets-v1/08374a7a-e173-45a9-8dfe-97a0a14c0dfd/microsoft-365-business-standard.png',NULL,0,140,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_microsoft-365-business-standard_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='microsoft-365-business-standard' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_microsoft-365-business-standard_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='microsoft-365-business-standard' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_1-800-flowers-com','1-800-Flowers.com','1-800-flowers-com','/__l5e/assets-v1/34513d53-5533-4b70-bd8a-f309e8959605/1-800-flowers-com.png',NULL,0,141,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_1-800-flowers-com_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='1-800-flowers-com' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_1-800-flowers-com_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='1-800-flowers-com' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_uber-uber-eats','Uber / Uber Eats','uber-uber-eats','/__l5e/assets-v1/a0abc646-4fb3-469e-8c4f-068d074799e5/uber-uber-eats.png',NULL,0,142,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_uber-uber-eats_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='uber-uber-eats' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_uber-uber-eats_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='uber-uber-eats' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_doordash','DoorDash','doordash','/__l5e/assets-v1/ef63d83e-484c-4651-bd34-81f5b517a52e/doordash.png',NULL,0,143,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_doordash_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='doordash' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_doordash_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='doordash' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

INSERT INTO gift_card_brands (id,name,slug,logo_url,accent_color,is_visible,sort_order,created_at,updated_at) VALUES ('brand_lowe-s','Lowe''s','lowe-s','/__l5e/assets-v1/f155dd4c-ec53-46f4-a76b-3e678cd9eb5c/lowe-s.png',NULL,0,144,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_lowe-s_us_physical',b.id,r.id,'physical',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='lowe-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;
INSERT INTO gift_card_variants (id,brand_id,region_id,card_type,min_value,max_value,rate_naira,is_active,created_at,updated_at) SELECT 'variant_lowe-s_us_ecode',b.id,r.id,'ecode',2500,50000000,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM gift_card_brands b JOIN gift_card_regions r ON r.code='US' WHERE b.slug='lowe-s' ON CONFLICT(id) DO UPDATE SET brand_id=excluded.brand_id, region_id=excluded.region_id, card_type=excluded.card_type, updated_at=CURRENT_TIMESTAMP;

