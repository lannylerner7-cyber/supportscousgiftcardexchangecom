# Settings, device alerts and account lifecycle

## Owner-approved policy

Closure is **deactivation**, not erasure. Account records and R2 evidence remain
private and retained for possible reactivation. The public account-help page
also explains how to request permanent deletion through support; no automatic
permanent erasure or arbitrary retention deadline has been invented.

Members re-enter their password and confirm DEACTIVATE. Requests can be cancelled
until admin approval. Available funds use the existing desk-managed withdrawal
flow, with its normal fee/minimum. A linked bank alone does not mean a transfer
happened. Below-minimum balances need support settlement. Pending trades,
requested/approved withdrawals, held money and account restrictions block approval.
Unlocked rewards are not confiscated. Only still-locked credit can be waived,
with explicit consent and a ledger debit. Waived credit is not restored later.

The last active administrator cannot close their account. Final eligibility,
wallet/ledger update, inactive state, session/device removal and email queue
insertion are atomic. R2 objects are intentionally retained under the owner's
revised policy. Inactive-account insert guards block new trades/withdrawals.

Reactivation requires a purpose-separated emailed code and admin approval.
An email link alone never reactivates an account. Old sessions remain revoked;
members sign in again and explicitly re-enable device notifications.

## Migration and rollout

The additive section in src/db/schema.sql is the source of truth. Run
`node scripts/apply-settings-migration.mjs` for a dry run and add `--apply`
only after confirming the database target. Do not execute the entire catalogue
schema against production. The additive migration has been applied to the
owner-approved shared D1 for preview testing; it deletes no existing rows.

Deploy the new source together. Existing cookie-only sessions require a fresh
sign-in once: sessions are now backed by the existing sessions table and checked
against active profiles on every authorized request. Do not roll back only the
session checks while keeping the new closure feature.

## Web Push

No new hosting service or paid push vendor is required. The current Node backend
sends standard Web Push to browser-provided provider endpoints. Keys are generated
server-side on first authenticated setup, partitioned by serving origin. The
private VAPID key is AES-GCM encrypted in D1 using a key derived from SESSION_SECRET;
only the public VAPID key reaches the browser. Keep SESSION_SECRET stable across
instances. Rotating it requires a deliberate push-key reset and device
resubscription as well as a new sign-in; do not silently overwrite encrypted keys.

Only explicit browser permission plus a stored, owned device subscription enables
push. Disabling all devices deletes those subscriptions. Existing push_enabled
values alone cannot cause delivery. Chrome/Firefox/Apple/WNS endpoints are
allowlisted; subscriptions are limited to ten per member.

The Node process starts a one-minute dispatcher after its first request. It
processes subscriptions from origins it actually serves. Run an always-on Node
Coolify service: this timer is not a serverless scheduling guarantee. Committed
notification rows are the event source, so no push call can fail a financial
transaction. New unread events only (last 24 hours, after subscription time)
become one durable delivery per device/event. Leases avoid parallel dispatch,
retries back off up to five attempts, and HTTP 404/410 removes expired endpoints.
Lock screens receive only a generic update and a fixed notifications-page link.
Providers offer at-least-once delivery: an ambiguous provider acknowledgement
may retry; a stable notification tag replaces the same alert on the device.

The support events implemented here are admin closure/reactivation updates, not
a claim that the existing Coming Soon live-chat page has been implemented.
Trade, withdrawal and referral notifications use the existing committed event feed.

Closure emails use a separate durable queue, up to five attempts, with delivery
status visible to administrators. Only a process serving the production canonical
origin drains closure mail automatically; preview does not mail real users.
Email-provider acceptance is not proof of inbox delivery.

## Verification and operational limits

Automated tests cover authorization, consent, duplicate requests, transaction
rollback, retained inactive records, session invalidation, last-admin protection,
verified reactivation, endpoint validation, generic payloads, opt-out and expired
endpoints. Browser/OS push receipt must also be verified on real target devices:
Android browsers and iOS/iPadOS 16.4+ Home Screen apps. Permission denial never
disables the in-app feed.

The existing five-public-page sitemap remains at /sitemap.xml. Account-help,
Settings, administrator pages and private content are excluded/noindex. See
SEARCH-AND-PWA.md for the separate approved Coolify and Google rollout checks.
