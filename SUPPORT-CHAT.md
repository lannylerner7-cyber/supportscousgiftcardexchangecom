# Persistent support chat

## Scope and rollout boundary

Settings is the only member launcher. `/app/chat` opens the same saved conversation.
Admin Messages has distinct Support inbox and Contact form tabs. Existing contact
submissions and their synchronous email behavior are unchanged.

**No live database migration, production deployment, real mail send or cloud
storage test was performed.** This workspace's configured D1/R2 resources are
shared with production. Apply the additive migration as part of the separately
approved Coolify rollout, before enabling this version:

```sh
cd artifacts/scous-exchange
node scripts/apply-support-migration.mjs          # dry run; no database access
# Only after reviewing/approving the target:
node scripts/apply-support-migration.mjs --apply
```

The migration preserves existing threads/messages, backfills deterministic
message order, and does not send alerts for old messages. Existing conversations
remain available; opening member support reuses the earliest existing thread.
The parser is tested, including CASE statements inside triggers and reapplication.

## Persistence and authorization

- D1 remains authoritative across devices and replicas. No new service is required.
- Concurrent opens use a deterministic member thread ID and unique member mapping.
- Message UUIDs and attachment identities survive failed/ambiguous responses.
  Retrying different content with the same committed identity is rejected.
- Triggers atomically insert message order, unread increments, attachment claims,
  reopen state and exactly one **outbox intent** per new member message.
- History uses a monotonic numeric cursor; newest/older pages are 50 rows.
  Forward recovery is ascending. The inbox paginates by immutable creation rowid
  rather than a mutable activity timestamp.
- Every endpoint checks an active database session and current role. SSE checks
  both on every tick; promotion, demotion, expiry, revocation and deactivation end
  the old stream. Images require active session plus thread ownership/admin role.
- Read cursors advance only after focused, visible viewport tracking, not network
  receipt. Unloaded unread history blocks advancement through that history.
- Join is explicit, session-bound, renewed while the admin tab is visible, and
  expires after 45 seconds. It is not a promise of human attention/response time.
- React renders plain message text. Images are decoded/re-encoded to WebP,
  metadata stripped, input limited to 10 MiB/25 million pixels, output constrained
  to 1800×1800. The browser currently uses a stricter 8 MiB input limit.
- Shared atomic per-account limits: 180 API calls/minute, 30 new sends/minute,
  20 uploads/minute, 20 stream admissions/minute; 100 image reservations/day and
  20 unlinked active reservations. Multipart bodies are bounded to 11 MiB even
  without Content-Length. Proxy request/body timeouts remain an operations gate.
- Text drafts/pending identities persist in per-user/thread sessionStorage.
  Photo files remain in browser memory across close/reopen; a reload explicitly
  warns to reattach a missing photo rather than silently losing it.
- Uncommitted image reservations are eligible for tombstoned cleanup after 30
  days. An active retry renews its reservation before PUT. Committed images are
  never cleaned by this worker. Expired identities fail explicitly.

## Realtime and resource model

`GET /api/support` uses SSE with authenticated POST mutations. Each app instance
has one shared hub: every 750 ms **after the previous query completes**, it reads
all that instance's active watchers in one D1 query using a single JSON parameter.
There is no process-local event bus dependency, sticky-session assumption, or
per-user database timer. Watchers include open threads, visible admin inboxes and
the visible Settings unread badge. Empty hubs issue no queries.

Connections are bounded to 128 per instance and 4 per account per instance,
expire after four minutes, honor aborts and close slow consumers. Admission
rate limits are shared in D1. Replay sends up to 100 messages per tick; clients
merge by stable identity and recover further history by cursor. SSE includes
read state, resolve state and expiring join state. Database failure closes
streams rather than trusting cached permissions.

Fallback: open chats catch up every five seconds after a bounded stream failure,
retrying SSE periodically. Visible closed badges/inboxes also have a 30-second
fallback; they normally update through SSE. Hidden badge/inbox subscriptions
close. Status distinguishes live/reconnecting/disconnected.

Expected hub request rate: approximately `1 / (0.75 + query_duration_seconds)`
per active instance, independent of watcher count within its bound. Returned
data and query work still scale with watchers/messages; this is **not evidence
of 10,000-user capacity**. Mutation/history/auth queries are additional.

Responses set `text/event-stream`, `Cache-Control: private, no-store,
no-transform` and `X-Accel-Buffering: no`, with heartbeats and replay IDs.
Verify actual Coolify/edge buffering, compression, timeouts, resource limits,
replica topology and cross-replica traffic during approved rollout. Those live
checks were deliberately not performed. The local two-hub test verifies shared
DB fanout logic, not a real multi-container deployment.

## Admin mail queue

New committed member text **and image-only** messages create durable intents.
Admin replies and send retries do not. The existing canonical-origin delivery
loop claims up to ten due chat jobs per pass, with 120-second token-fenced leases,
five maximum attempts and exponential backoff. Jobs remain stored after failure.
Admin Mail & alerts displays pending/exhausted counts. Safe error categories are
stored; private chat content is not put in email or logs.

Recipients are read from existing admin alert settings at dispatch time. The
branded email contains a generic summary and an authenticated thread link;
support links retain their destination across normal sign-in/OTP. No image,
member message, gift-card code or attachment is included.

One durable intent is not exactly-once external delivery: acceptance followed
by a crash/lost provider response can result in a retry email. Missing recipients
also retry and eventually exhaust. Investigate delivery configuration before
an operator resets a selected exhausted job's attempts/next_at; do not blindly
reset the whole queue. Keep canonical-origin health traffic on running replicas
so the existing background dispatcher starts. Preview never drains real chat mail.

## Verification evidence

Commands:

```sh
node --test tests/*.test.mjs
pnpm typecheck
NITRO_PRESET=node_server pnpm build
```

Isolated SQLite tests cover creation races, ambiguous commit retries/content
conflicts, transactional outbox rollback, ordered pagination, image-only alerts,
attachment claims/validation/ownership, read cursors, resolve/reopen, session and
role revocation, two independent hubs, shared rate limits, mail leases/retry/
exhaustion, cleanup, migration reapplication and live closed-badge updates.

Controlled healthy in-memory workload: 8 open streams, 6 sequential member
commits, default 750 ms scheduler. Commit-to-stream results were approximately
750–754 ms; six hub queries total, zero queries with no subscribers. This omits
real D1/provider/network cost.

A real browser pass against the isolated full-app fixture verified separate
member/admin/other-user sessions, Settings dialog/mobile layout, waiting/join,
text and real PNG image-only sends in both directions, close/reopen, refresh,
sign-out/sign-in, resolved-thread reopening, distinct contact submissions,
deep links, denied history/image access, lost committed-response reconciliation
without duplication, and live admin-session revocation.

Targeted focused-view checks confirmed text and image read receipts without
typing/sending. Four measured send-click-to-other-browser-render samples:
**816 ms, 934 ms, 998 ms (text), 1,675 ms (image-only)**. All are local fixture
measurements, not a production guarantee. A closed-badge delay exposed by the
browser was changed from fallback-only polling to shared-hub SSE and covered by
a focused server regression test plus type checking.

Browser pagination, a physically separate device, a real Android software
keyboard, explicit user-click retry after lost commit (SSE reconciled first),
provider email receipt and live proxy/replica measurements were not exercised
in the browser. Server tests cover paging, explicit same-ID retries and queued
email failure recovery. Do not substitute local results for the remaining
environment-dependent rollout checks.

### Reproducible isolated browser fixture

```sh
pnpm exec vite --config vite.support-fixture.config.ts --port 3101
```

Use only localhost:3101 with this explicit test config. It replaces D1 with
`/tmp/scous-support-browser.sqlite`, R2 with memory and email with
`/tmp/scous-support-fixture-mail.json`. Test accounts are seeded in the fixture
source, and OTP can be read from the intercepted local test mail. This config
is never used by normal dev/build or included in the production output.
Never publish or expose the fixture server. Stop it after testing.
