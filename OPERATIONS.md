# Scous verification and rollout

See [SCALING.md](SCALING.md) for isolated measurements, caching freshness rules,
health probes, replica safety gates, alert thresholds and the scaling runbook.
These measurements do not establish capacity for 10,000 simultaneous users.

## Local checks

With Node 24 and pnpm:

```sh
pnpm --filter @workspace/scous-exchange run typecheck
pnpm --filter @workspace/scous-exchange run test:rewards
NITRO_PRESET=node_server pnpm --filter @workspace/scous-exchange run build
```

The reward tests use in-memory SQLite; they never use the live database or send mail.
They cover inviter-only payment, verification retries, legacy payouts, transactional
rollback, and successful/partial/declined/concurrent trade reviews.

## Login and support schema release gate

Before releasing code, run this **read-only** check from the exact release source
checkout, using Node 24+ with dependencies installed. It is operator tooling,
not included in the minimal runtime container. Use a secure checkout/job configured
for the intended deployment's existing D1 transport; do not paste credentials into
commands or logs. Verify the target account/database in deployment configuration
before running (the report intentionally does not print identifiers).

```sh
cd artifacts/scous-exchange
node scripts/check-schema-readiness.mjs          # usage/scope only; no D1 access
node --test tests/schema-readiness.test.mjs      # isolated in-memory SQLite only
pnpm schema:check                               # explicit read-only target check
```

Release checklist:

1. Confirm the target and obtain the separate migration/deployment approval.
2. Run `schema:check` before the rollout. Exit **0** / `ready` passes the schema
   gate; **1** / `not_ready` blocks release and lists missing or mismatched objects
   with their repository migration source; **2** / `check_failed` blocks release
   because the check could not finish (access, configuration, timeout or tooling).
3. For missing requirements, review the named migration and a fresh recovery
   backup/bookmark, then apply it through the separately approved migration
   procedure. A report is not a migration command. `CREATE IF NOT EXISTS` cannot
   repair a partial existing table, index or trigger; prepare a reviewed additive
   repair rather than dropping live objects. Remember-device handles are defined
   in `schema.sql`, but not in `remember-devices.sql`.
4. For support triggers, follow `SUPPORT-CHAT.md` and the current approved
   Cloudflare SQL-file import procedure; do not assume the query/batch endpoint
   accepts trigger bodies or treat tables-only migration as success.
5. Re-run against the same target after upgrades and before switching application
   traffic. Retain the safe JSON report with the release evidence. A failed check
   must not be overridden by a passing liveness probe.

The checker only reads `sqlite_master` and schema PRAGMAs. It never reads member
rows, sends mail, writes to D1, applies migrations, or exposes a public diagnostics
route. It checks login/session/OTP/rate-limit, account authorization, remembered
devices, support state/messages/attachments/outbox, and mail-settings structures.
Required columns (including types/defaults/PK), foreign keys, implicit uniqueness,
named indexes and trigger definitions are compared with this checkout's schema.
Extra objects/columns are allowed. Index/trigger comparison tolerates whitespace
and `IF NOT EXISTS`, but intentionally flags other textual differences for review;
equivalent custom DDL may need human review. This is not an all-feature database
audit, data/backfill verification, mail/storage test or capacity guarantee.

Keep `/api/public/live` independent: it must return without D1/schema checks or
delivery startup. Do not use `schema:check` as a container liveness/restart command,
and never invoke migrations or this release gate on incoming requests. A schema
failure should stop a release, not cause restart loops. No live check or upgrade
is performed by the isolated test suite.

## Cloudflare email configuration

For Cloudflare Email Sending, set `SMTP_PROVIDER=cloudflare`. The app uses
`smtp.mx.cloudflare.net`, port `465`, implicit TLS, and username `api_token`.
`SMTP_PASS` must be an API token with **Email Sending: Edit** for the correct
account. Store it only in the deployment's secrets.
`APP_EMAIL_FROM` is a bare sender email address whose domain is onboarded for
Cloudflare Email Sending, without a display name or `From:` prefix.

The existing Lovable Cloudflare HTTPS email route still takes precedence when
its credentials are configured. Other SMTP providers retain configurable settings.
Provider acceptance of a message is not proof of inbox delivery.

Documentation: https://developers.cloudflare.com/email-service/api/send-emails/smtp/

## D1 and R2

The preview uses the authorized Replit Cloudflare connection only when
`CLOUDFLARE_USE_REPLIT_CONNECTOR=true`.
Do not enable that flag on Coolify: retain its existing direct Cloudflare or
Lovable gateway credentials, account/database IDs, and private R2 bucket.

D1 transactions use the documented native parameterized `batch` request.
Keep each wallet change and its ledger entries in one batch. Do not fall back
to issuing individual HTTP writes if a batch fails.

Documentation: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/

## Reward policy and existing data

- New member: ₦5,000 welcome bonus, locked until a **successful** card redemption.
- Inviter: ₦2,000 once the invited member completes signup email verification.
- No new-member referral bonus; no new referral payout at card redemption.
- Existing balances are not retroactively changed or clawed back.
- Legacy payout records prevent duplicate awards. A zero-value compatibility
  marker also protects against the older Coolify build paying again at redemption.
- No schema migration is required for these changes.

## Production rollout boundary

Read `SETTINGS-LIFECYCLE.md` before rolling out account lifecycle changes:
it documents the additive migration, fresh-sign-in requirement, retained data,
notification dispatcher and push key handling.

For public indexing, PWA cache policy and phone installation checks, also read
`SEARCH-AND-PWA.md`. Keep its private-route noindex rules and never cache account
or gift-card data when extending the service worker for push notifications.

Workspace edits do not update the existing Coolify deployment. Before deployment,
review the diff and deployment configuration, preserve a backup, and obtain approval.
After deployment, use designated test accounts and a non-sensitive sample image to
verify signup/email, upload, owner/admin viewing, and rejection for unrelated users.
Do not mark the live-site upload issue resolved solely because preview storage works.

The user's existing D1 is shared with production. Never reset it or run fixture
cleanup against broad email patterns; clean only IDs created by the test.
