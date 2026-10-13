# Remembered-device login rollout

This change is prepared in source only. It does not deploy Coolify or migrate D1.

1. Back up the existing D1 database through your usual administrative process.
2. Review and apply `src/db/remember-devices.sql` to the application's existing D1 database before deploying the new server. It creates two tables and an index; it does not change balances or reward records.
3. Deploy the reviewed source through the existing Coolify setup. Keep the existing SESSION_SECRET and email configuration. No new provider credentials are required.
4. Existing sessions deliberately need a fresh login. Do not backfill session verification flags: older sessions did not prove that login OTP was completed.
5. Using a controlled account, check password + OTP enrollment, browser restart, remembered password login, and sign-out followed by login. Inspect the support return flow as well.
6. Verify that failed email delivery leaves the account behind the OTP screen, not signed in. Check expired/revoked device behavior and password reset.
7. An unfinished signup resumes signup verification after the next correct-password login, even if its original session expired. That OTP confirms email and applies the normal inviter reward once; it is not treated as an ordinary login OTP.

The unchecked option uses a browser-session cookie with a 24-hour server limit.
Remembered devices and their sessions last at most 30 days. Recognized-device
logins keep the original expiry; they do not silently extend trust forever.
The first enrollment requires password plus email OTP. The existing server-owned
administrator exception remains separate and does not enroll a device.

Device credentials are random, HttpOnly, Secure cookies; D1 stores their hashes.
Sign-out removes this device's trust. Password change/reset and account
deactivation revoke all remembered devices and sessions. Password changes redirect
to login; successful reset retains the existing recovery session behavior.

Browser “restore previous session” features may retain session cookies. Server
expiry remains enforced even in those browsers. Shared computers should not be
remembered, and users should sign out when finished.

## Isolated checks

Run `pnpm typecheck`, `pnpm test:rewards`, and `pnpm build` in this directory.
The auth tests use in-memory SQLite and captured mail, not D1 or SMTP.
For browser verification, the explicit `vite.support-fixture.config.ts` config
replaces D1, R2 and email delivery with local fixtures. Never deploy that config.
Normal dev/build commands do not select it.
