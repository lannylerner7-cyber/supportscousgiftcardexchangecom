# Scaling readiness — isolated evidence, not a capacity guarantee

## Decision and limits

Keep Coolify on AWS, D1 and private R2. **10,000 simultaneous users is untested.**
No production load, provider benchmark, deployment or provisioning was performed.
The existing D1 is shared with production; there is no approved isolated provider
database/bucket for this exercise. All fixtures use in-memory SQLite; email, push
and storage in regression tests are mocks. Payout processing is not invoked.

“Active users” means unique people in a window, not concurrent requests. For
example 10,000 users each making one request every 30 seconds implies 333 RPS,
before navigation fan-out. At 500 ms average service time that implies about 167
in-flight requests, not 10,000. A synchronized launch of 10,000 requests is a
different burst and must be tested separately with admission control.

## Path audit (D1 HTTP round trips, not SQL row counts)

| Path | Before | After / limits |
| --- | --- | --- |
| Account bootstrap | 4: session+active profile, profile, avatar state, role | 3: role EXISTS folded into profile; no server private cache |
| Wallet / statement | 2 each, including fresh session check | unchanged; statement max 100 |
| Public brands, regions, variants, top rates, banks | 1 per call | 1 cold; 0 warm within 5s; same-key in-flight coalescing |
| Banners | 1 per call | unchanged so schedule boundaries aren't cached |
| New trade evidence upload | 6: session, ownership, prior, reserve, verify reservation, finalize + R2 PUT | unchanged; max 5 images; ambiguous commits preserve evidence |
| Existing uploaded proof retry | 3 | unchanged; scoped to owner and trade |
| Chat upload | 2 + R2 PUT | unchanged; owner check mandatory |
| Push dispatch/origin/tick | enqueue + scan, then claim/keys/consent/ack per job | existing batches max 20; atomic token leases, max 5 attempts |
| Closure mail/tick | scan + claim/ack per job | max 10; max 5 attempts |
| Native dispatch/platform/tick | enqueue + scan + claim/consent/ack per job | max 20; max 5 attempts |
| Readiness | table COUNT every probe | SELECT 1, shared promise, success/failure TTL 15s |

Navigation shares React Query account key (30s browser staleness); authorization
is still checked on every protected server operation, including revocation and
inactive membership. Market polling is 30s; hidden tabs no longer poll, and focus
plus visibility events no longer both trigger the same refresh. There is no
server cache of roles, balances, session validity or trade rate eligibility.

Public cache: 64 entries/process, 5s absolute TTL, failed loads evicted, writes
through execute/transaction and non-SELECT query paths invalidate locally even on
ambiguous outcomes. An old in-flight read cannot repopulate an invalidated key.
Other replicas expire within 5s; browser market polling can add 30s display delay.
Trade submission reads the authoritative rate, not cached display data. Scheduled
banners remain uncached. Frequent private writes conservatively flush this cache,
so read-only benchmark savings are an upper bound. No relational cache table.

Existing indexes cover sessions, roles, owner/date lists, catalogue filters and
notification recipients. Added partial due-job indexes exclude sent/exhausted
history, avoiding scans through growing delivery history. These schema changes
are **not applied to live D1**. Apply only SCALING_INDEXES_START…END after backup
and approval. Do not blindly re-run all schema statements against production.

## Reproduce isolated evidence

From workspace root (Node with TypeScript stripping and experimental SQLite):

```
pnpm install --frozen-lockfile
node artifacts/scous-exchange/scripts/scaling-load.mjs
pnpm --filter @workspace/scous-exchange test:rewards
pnpm --filter @workspace/scous-exchange typecheck
```

The harness has no target URL, disables fetch, and accepts no credentials. It
exercises the actual public-cache component over SQLite, **not the HTTP server**.
Dataset: 1,000 catalogue rows, 10,000 synthetic members. Mix: 70% public catalogue,
30% private owner reads. 20 consecutive closed-loop bursts of 100 simultaneous
operations, 2,000 total; synthetic 5ms transport delay. There is no think time,
production TLS, D1 REST rate limit, real image decoding or provider delivery.
Returned rows below are not D1 billed rows scanned.

Recorded workspace sample:

| Measure | Before | After |
| --- | ---: | ---: |
| Duration | 202.61 ms | 104.97 ms |
| Simulated operations/s | 9,871 | 19,052 |
| p50 / p95 / p99 | 7.18 / 10.32 / 24.11 ms | 0.03 / 5.23 / 5.28 ms |
| Errors | 0 | 0 |
| DB calls | 2,000 | 601 |
| Returned rows | 140,600 | 700 |
| Process CPU | 122.46 ms | 6.52 ms |
| RSS at end | 100.91 MB | 101.04 MB |

This demonstrates **69.95% fewer simulated DB calls**, not 19,052 live RPS.
Private reads remain 600/600. The short run does not measure sustained memory,
cache turnover under writes, provider capacity, or AWS CPU/network limits.
Observed simulation limit is timer scheduling/serialization; expected live
constraints are REST latency/quota, D1 serialized queries and upload memory.

Regression tests exercise actual transaction/upload/delivery handlers with
SQLite and mocked external providers: concurrent trade retries, ambiguous
commits, rollback, opt-out, repeated push failures, exhausted attempts, expired
worker lease recovery and token-fenced acknowledgement. Cache tests cover
coalescing, bounded keys, expiry, invalidation during a read, outage and recovery.
No exactly-once external-delivery claim: a worker may crash after a provider
accepts a message but before acknowledgement. Retry can duplicate a notification,
not a wallet mutation. Durable notifications are committed in financial batches;
dispatchers never write wallets. Withdrawal concurrency remains a mandatory
production scale-up prerequisite in the separately planned withdrawal work.

### Next representative staging experiment (requires approval/resources)

Seed a separate D1 and private R2 with 10k members, 100k trades, 1m ledger rows,
100k notifications, 1k catalogue variants and bounded sample images. Use test-only
email/push/payout sinks. Exercise 40% catalogue, 20% account, 15% wallet/history,
10% notifications, 10% trade read/create and 5% upload; preserve user ownership
and verify read-after-write and revocation. Start at 10 RPS, ramp 50/100/200/333
RPS for 5 minutes each, then 60s bursts at 500 RPS. Separately model a 10k-arrival
burst only after smaller stages meet SLOs. Record offered/achieved RPS, concurrent
in-flight requests, p50/95/99 by route class, timeouts/429/503, CPU, RSS, event-loop
lag, network bytes, D1 duration/rows scanned, R2 latency and queue oldest age.
Stop at >1% errors or p95 >1s for 2 minutes; never silently drop failed arrivals
from percentiles. Run crash/retry, unavailable D1, unavailable provider, rolling
restart and restoration drills. None of those provider measurements are complete.

## Observability and alerts

Request AsyncLocalStorage creates a random correlation ID, returned as X-Request-ID;
D1 calls and delivery cycles carry it. Never trust incoming IDs. Fixed event
labels only, bounded counters and latency buckets (<=10/50/100/500/1000/>1000ms),
no SQL, parameters, email, keys, object paths or response bodies. Error/slow calls
always log; ordinary calls log every 100th with cumulative count/errors/time/max.
Production console errors are redacted, including framework errors. Aggregate
counter deltas per instance; counters reset on restart. Bucket estimates are
coarse, not exact p95/p99. Collect container CPU/RSS and proxy request metrics
separately; these are not implemented monitoring infrastructure.

Initial alert thresholds, tune against representative staging:
* request 5xx/503 >1% for 5min; p95 >1s or p99 >3s for 5min;
* D1 error >0.5%, sustained 429, or duration >500ms for 5min;
* CPU >70% or RSS >75% container limit for 10min;
* due job age >5min, any unsent attempts>=5, web terminal=1, lease age >3min;
* readiness failing twice (30s); liveness failing three times.

For queue alerts use a protected operator query against each delivery table:
count unsent attempts>=5 and MIN(next_at) where sent_at IS NULL and attempts<5
(and terminal=0 for web). Run at most once/minute centrally, not per public probe.
Inspect failed jobs without exposing recipients in logs. Do not automatically
reset exhausted attempts: identify provider cause, confirm consent, then replay
selected IDs under an audited operator action. Retry backoff is bounded and
existing provider calls have timeouts. Leases are 120s and token-fenced.

## Multi-instance and operations gates

* Keep identical SESSION_SECRET and provider/D1/R2 configuration on every replica;
  it also protects stored push keys. DB sessions and roles are shared; no sticky
  sessions needed. Session expiry/revocation never goes through public cache.
* Local state: cache, metrics, request count, dispatch timer/running flag/origin
  set, native provider access-token cache and SSR module/error capture. None is a
  financial source of truth. Dispatcher starts on requests, so ensure the
  canonical-origin health traffic warms each replica. No durable queue is local.
* Leases arbitrate DB job ownership across processes. Notification ID provides
  device deduplication hints, not provider exactly-once semantics. Five failed
  claims exhaust native/mail jobs; web jobs also become terminal.
* Login attempt records are shared, but count-then-insert checks are not an
  atomic distributed rate limiter. A legacy signIn entry point also exists.
  **Do not expose increased replica capacity before edge/proxy auth throttling
  and endpoint coverage are verified.** In-memory rate limits cannot solve this.
* Proxy must strip untrusted forwarding headers and set its own; don't use
  client-supplied X-Forwarded-For as a trusted identity. Block direct app access.
  Set body-size/time limits at proxy (including multipart overhead), because
  formData parsing happens before image size validation.
* Application admission cap is 128 active handlers per process; excess/draining
  requests get 503 + Retry-After. It is a guardrail, not a proven safe upload
  concurrency level. Proxy needs a much lower upload concurrency limit based on
  image size/RSS measurements; do not automatically retry financial POSTs.
* /api/public/live checks process only; /api/public/health checks D1 at most once
  per 15s/process and reports R2/email **configuration**, not connectivity.
  Dependency failures must remove an instance from LB service, not restart every
  container. D1 calls have 15s timeouts and no blind write retries.
* SIGTERM stops new request admission/job claims; in-flight work is left to the
  HTTP runtime drain. Compose allows 150s, longer than a lease. After forced kill,
  leases expire and other replicas recover. Verify the built Nitro runtime drain
  in staging before rollout; workspace simulation is not that verification.

## Staged change, backup and rollback

1. Obtain deployment approval separately; fix withdrawal concurrency and verify
   distributed auth throttling first. Save the current image/config securely.
2. Export D1 and record a Time Travel bookmark; inventory private R2 and securely
   back up required objects. Restore into a separate test database/bucket, check
   row counts and wallet/ledger reconciliation, sessions, and image ownership.
   D1 recovery does not restore R2. No backup/restore drill was performed here.
3. Apply only additive due-job indexes after checking query plans on staging.
   Compare EXPLAIN QUERY PLAN and rows scanned as delivery history grows.
4. Canary one replica, compare metrics and failed jobs for 30min; expand only
   after SLOs and financial reconciliation hold. Existing rollout task owns this.
5. On regression remove canary from LB, drain, restore prior image. Indexes are
   backward-compatible and can remain. Do not roll back financial data to undo
   a code release. For data corruption stop writes and use an approved recovery
   plan reconciled against payments and R2 before re-opening.

## Evidence-based infrastructure decisions

| Option | Trigger | Prerequisites / cost and consistency |
| --- | --- | --- |
| More app replicas + LB | app CPU/queue saturates while D1 remains healthy | approved AWS budget, shared secrets, LB readiness/drain, distributed auth limits; doubles polling and cold caches |
| Redis | repeated public reads/cache misses or rate-limit coordination materially bottleneck | approved service/network/TLS/ops costs; versioned invalidation, bounded TTL, never cached financial eligibility or revocation |
| Managed queue | measured job age exceeds SLO despite bounded workers/indexes | approved usage budget and DLQ ownership; use transactional outbox, at-least-once/idempotent consumers, never async wallet commits |
| Worker/D1 Sessions | REST latency/quota dominates and read load is significant | approved Worker deployment/access and usage costs; authenticated server-to-server API; first-primary for auth/money, propagate scoped bookmarks for read-after-write |
| Sharding | optimized primary write throughput or database size remains limiting | explicit partition ownership, reconciliation, cross-shard transfer design and migration budget; not justified by a hypothetical user count |

Official Cloudflare documents consulted 2026-10-08:
* https://developers.cloudflare.com/d1/platform/limits/ — individual database is
  single-threaded, queues then overloads; max 10GB paid / 500MB free.
* https://developers.cloudflare.com/d1/best-practices/read-replication/ — Sessions
  API is Worker binding only, **not REST**; enabling replicas alone changes
  nothing here. Replicas can lag arbitrarily without session constraints.
* https://developers.cloudflare.com/d1/platform/pricing/ — replicas have no extra
  storage/compute surcharge; billed rows still apply. Paid included 25bn reads,
  50m writes/month, then $0.001/million reads, $1/million writes; storage above
  included 5GB is $0.75/GB-month, plus Workers plan/usage. Recheck before purchase.

Redis/queue/AWS pricing depends on provider, region and tier; obtain quotes and
owner approval, not a guessed fixed monthly cost. No new services purchased.
