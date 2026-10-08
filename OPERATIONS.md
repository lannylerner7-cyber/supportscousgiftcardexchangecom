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

## Cloudflare email

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
