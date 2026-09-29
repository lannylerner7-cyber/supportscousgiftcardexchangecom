# ScousGiftCardExchange — move onto your own Cloudflare D1 + R2

I downloaded and read the repo (`lannylerner7-cyber/redeem-and-rest`). This project is currently the blank starter, so step one is bringing the whole codebase in here unchanged, then moving the data layer to your own Cloudflare database.

## What the repo contains today

- Public pages: home, rates, support, terms, privacy, login, signup, code screen, forgot/reset password, verify email
- Member area: dashboard, trade, history (+ detail), withdraw, chat, notifications, settings
- Admin area at `/ScousGiftCardExchange/admin`: overview, trades (+ detail), rates, users (+ detail), withdrawals, messages, mail settings, audit log
- 22 tables with indexes, 6 status/type lists, and money logic held in database procedures: wallet changes, trade review, withdrawal creation, wallet adjustments, bonus lock/unlock, platform stats
- A dependency-free mail sender already written for Cloudflare SMTP on port 465, 6-digit codes with 5-minute expiry, 60-second resend cooldown, hourly cap, 3 attempts
- Dockerfile and compose file, both health-checking the homepage rather than a real health endpoint

## One thing I need to flag

Cloudflare's D1 cannot be wired directly into the site the way it can on a hand-deployed Worker. The site will reach D1 through Cloudflare's own database API using your account. That is fully supported, works identically in the preview, on the published site and inside your Docker container, and keeps one single database everywhere. It needs your Cloudflare account connected plus the database ID.

Second: D1 has no built-in per-row access rules like the current backend. Every read and write therefore gets its permission check written into the server code — member can only touch their own rows, admin pages check the admin role on the server before anything loads. That is where most of the care in this job goes.

## Plan

### 1. Bring the codebase in
Copy every page, component, style, brand token, asset and helper from the repo into this project, minus the old backend files and the old `.env` (secrets never get copied). Nothing visual changes.

### 2. Build the D1 schema
Recreate all 22 tables with the exact same columns the app already reads and writes — profiles, user_roles, brands, regions, variants, trades, trade_images, wallets, wallet_transactions, bank_accounts, banks, withdrawals, chat_threads, chat_messages, notifications, otp_codes, login_attempts, campaign_banners, smtp_settings, contact_messages, app_settings, admin_audit_log.

- Every existing index recreated, plus the lookup indexes searches actually need (brand/region/card-type, email, phone, status+date, thread+date) so lists and searches never scan whole tables
- Money stored as whole kobo integers so balances, fees, holds and the ₦300 withdrawal fee can never drift
- Status lists kept as strict allowed-value checks
- Seeded fresh: the admin account, the rate table, regions and brands. No test members, no test trades.

### 3. Move the money logic into the server
The database procedures become server functions that run as a single all-or-nothing batch, so a trade approval, wallet credit and ledger row either all land or none do: wallet change, trade review (approve/decline/partial with note), wallet adjustment, withdrawal creation with PIN, withdrawal decision, trade creation, bonus lock/unlock, platform stats, freeze account.

### 4. Accounts, codes and PINs on D1
Signup, login, sessions, the 6-digit codes, the login lock-out and the withdrawal PIN all live in D1, with the session held in a signed, server-only cookie. Every rule already in the app is kept: unknown-email message, 3 failed attempts = 30-minute lock showing the unlock time, 60-second resend cooldown, hourly cap, 5-minute code expiry, codes stored hashed only.

### 5. SMTP and code delivery, verified end to end
Keep the existing sender, point it at your Cloudflare SMTP credentials, and prove it: request a code to a real inbox, confirm it arrives, confirm the same code signs in, confirm a wrong code and an expired code are both refused, confirm resend cooldown behaves. Same check for the welcome and alert emails. A mail health line in the admin mail screen shows whether sending is live.

### 6. Card photos and chat images on R2
Uploads go to your own R2 bucket through the server (1–5 photos per trade, size and type checked), and are shown through short-lived private links so proofs are never publicly reachable.

### 7. Admin area
`/ScousGiftCardExchange/admin` stays exactly where it is, gated server-side by the admin role in the roles table — never by anything in the browser. Every screen gets rewired to D1 and every admin action writes an audit row.

### 8. Docker and health checks
A real health endpoint reports the app, database, mail and storage in one response. Dockerfile and compose health checks point at it, with correct start period, interval and retries; the container runs as a non-root user and reads every credential at start-up so nothing secret is baked into the image. Deployment notes updated.

### 9. Route-by-route verification
Walk all 26 pages signed out, as a member and as admin: nothing 404s, nothing shows a blank error, lists load, and one full journey runs through — signup, code, trade with photos, admin approval, wallet credit, withdrawal with PIN, admin payout — with the numbers checked in the database after each step.

## What I need from you

- Your Cloudflare account connected (I will open the connect card)
- The D1 database ID and account ID, and the R2 bucket name
- The Cloudflare SMTP user and token, sender address, sender name, reply-to
- The admin email and the public site address

I will request each credential through the secure form — never in chat.

## Technical notes

- D1 accessed over the Cloudflare API through the Lovable gateway from server functions only; one query module, prepared statements with bound parameters, `batch()` for transactions
- SQLite types: `TEXT` UUIDs via `crypto.randomUUID()`, `INTEGER` kobo for money, ISO-8601 `TEXT` timestamps, `CHECK (... IN (...))` in place of Postgres enums, `PRAGMA foreign_keys` on
- Authorization moves from row-level policies into a shared `requireMember` / `requireAdmin` middleware on every server function; admin role read from `user_roles`, never from the profile row
- Session cookie: HttpOnly, Secure, SameSite=Lax, HMAC-signed with a generated server key; codes and PINs stored as salted hashes
- R2 via S3-compatible signed PUT/GET from the server; no bucket public access
- Health endpoint at `/api/public/health` returns 200 only when D1 responds, plus per-subsystem status
