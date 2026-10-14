# Member passkeys

## Release status and prerequisites
Passkeys are off unless `PASSKEY_ENABLED=true`. This release does not apply a live
migration, publish source or deploy Coolify. Password/OTP and representatives retain
their existing behavior while disabled.

Before enabling, an authorized operator must capture a D1 recovery bookmark,
review and apply `src/db/passkeys.sql`, run `pnpm schema:check`, then configure:

- `PASSKEY_ENABLED=true`
- `PASSKEY_RP_ID=scousgiftcardexchange.com`
- `PASSKEY_ORIGINS=https://scousgiftcardexchange.com`

Origins are explicit comma-separated HTTPS origins under the RP ID. Do not use
wildcards, request-host inference or arbitrary preview origins. Test credentials
for localhost cannot sign in on the production domain. No new secrets are needed.
Apply migrations separately; no passkey request performs schema upgrades.
Rollback: disable the flag and keep additive tables. Existing passkey sessions
become invalid; members can sign in with password. Never drop user credentials as
an automatic rollback action.

## Security and sessions
Discoverable passkeys require authenticator user verification. Only public keys
are stored in D1; private keys/biometrics remain on the device or passkey provider.
Challenges are hashed, browser-bound, single-use and expire in five minutes.
Challenge consumption and authenticated session creation use one bound D1 batch.
Registration rechecks account state and the original verified session in its batch.
Credential IDs are globally unique; each member may have ten current credentials.
Synced authenticators with zero counters are supported; nonzero counters are
checked by the verifier and compare-and-set database update.

Enrollment and management require a verified active member with a session created
in the last five minutes or a current password. Representatives (including the
configured owner email) cannot enroll or authenticate using passkeys.
Password login keeps its OTP policy even if the account has passkeys. Signup email
verification and rewards are unchanged.

Remembering is opt-in: 30-day server session and cookie expiry, otherwise a
browser-session cookie and 24-hour server lifetime. Passkeys do not create a
trusted-device token to bypass OTP on a later password login. Removing a credential
immediately invalidates every session using it through guard checks; removing the
current credential signs out this browser. A password change/reset invalidates
existing credentials through the password-version binding; enroll again after
recovery. Frozen, deactivated, unverified or newly promoted representative accounts
cannot continue passkey sessions.

Client query data is cleared on identity switches. Trade draft routing IDs remain
member-scoped; private image bytes, card codes and PINs are not cached as part of
this feature. Reloading does not promise restoration of unsaved file selections.

## Limits and evidence
Per minute: 20 passkey requests per bound browser, 10 sensitive management attempts
per member, and 3,000 passkey requests globally. Counters update atomically in D1.
These are abuse-protection defaults, not capacity guarantees. Existing server
admission control also limits in-flight requests. Expired challenges and limiter
rows are cleaned in bounded batches of 100 on challenge creation; idle expired
rows are harmless and can be cleaned by an operator if needed.

Options issue: two limiter writes, optional member checks, one challenge write and
two bounded cleanup writes. Authentication verification: two limiter writes,
indexed challenge and credential reads, one six-statement atomic batch, cookie
publication. Signed-in passkey authorization adds one indexed credential/session
lookup to existing session checks. Never cache authorization or replicate these
reads without strong revocation consistency.

`node --test tests/passkeys.test.mjs` uses real EC signatures and local SQLite only.
Its 10,000-attempt test exercises limiter rejection, not 10,000 WebAuthn handshakes,
network requests or distributed D1/Coolify capacity. No live load test is authorized.

## Browser and native support
Use a current HTTPS browser with WebAuthn and a discoverable authenticator.
The current Capacitor remote-hosted test APK explicitly shows password/browser
fallback; a native credential bridge, Android association configuration and real
device verification are separate work. TV support and store readiness are not
claimed.

The explicit `vite.passkey-fixture.config.ts` uses local SQLite, intercepted mail,
stubbed R2 and HTTPS localhost:3102 with a temporary test certificate. It is never
selected by normal dev/build commands. Do not test signup or account writes against
production data.

## Verification completed
- TypeScript check and 132 automated tests passed. After the final atomic
  management-session guard tightening, the six dedicated passkey tests passed again.
- Node-server production build passed.
- One isolated Chromium virtual-authenticator pass confirmed password/OTP login,
  enrollment prompt, enrollment, rename, remembered passkey login, unchanged captured
  mail during passkey login, removal/current-session signout, no-key error and
  password fallback navigation, and representative exclusion.
- The second password-fallback OTP entry was not independently confirmed by that
  browser run; the initial OTP entry and existing automated OTP tests passed.
  Native cancellation UI was not exercised separately from the no-key failure.
- The local 10,000-attempt limiter simulation admitted exactly 20 and rejected
  9,980; observed runtime was approximately 0.6–0.9 seconds in local SQLite.
  This does not measure live network latency, full authentication throughput,
  physical-device biometrics or production capacity.
- No production migration, real notification, deployment or GitHub push was made.
