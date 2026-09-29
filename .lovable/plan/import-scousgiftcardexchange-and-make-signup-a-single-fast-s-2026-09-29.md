# Import ScousGiftCardExchange and make signup a single fast step

## What this does

Bring the whole `scousexchange` repository into this project — every file, nothing left out (169 files: all pages, components, brand images, database schema, server code, config) — and then make account creation noticeably faster.

Today signing up makes the browser wait for three separate round trips, one after another:

1. Create the account (users, profile, wallet, role)
2. Finish signup (sends the welcome email)
3. Request the verification code (a separate database rate check, code write and email)

After this change, the browser makes **one** request. Everything happens on the server in a single step, and only the verification code email is sent while the person waits. The welcome email is sent later, right after they confirm their email address.

## Plan

### 1. Import the repository

Copy all files from the repo into this project exactly as they are — source, routes, components, brand images, database schema, Docker and deployment files, config. Install the dependencies listed in the repo's package file.

Note: the app talks to a Cloudflare D1 database and a mail account through settings (account ID, database ID, API key, mail credentials) that are not present in this project yet. The code will be complete and will build, but live signup/login will only work once those values are supplied. I will list exactly which ones are missing after the import.

### 2. One server call for signup

Add a single `registerAccount` server function that does, in order:

- validate the form input
- check the email isn't already taken and look up any referral code
- hash the password
- run **one** batched database transaction containing: account row, profile, wallet, user role, optional admin role, the OTP rate-limit bookkeeping (invalidate previous unused codes) and the new hashed verification code
- open the session
- send **only** the verification-code email
- return everything the signup page needs: success/failure, the code's expiry time, whether mail is configured

The signup page calls this one function instead of the current three, then goes straight to the verification screen.

### 3. Batched database work

The OTP rate check (cooldown and hourly cap) is read together with the duplicate-email check in one read round trip. All writes — account, profile, wallet, roles, OTP invalidation, OTP insert — go into a single `transaction()` call in `d1.server.ts`, so the signup either fully happens or not at all, in one database request.

### 4. Welcome email after verification

- `completeSignup` no longer runs during signup.
- The welcome email is sent from the signup-code verification step, after the code is accepted, and is not awaited — verification returns immediately and the email goes out in the background.
- The existing fallback stays: when no mail account is configured, the profile is marked verified straight away so nobody is locked out, and signup goes directly into the app.

## Technical notes

- New: `registerAccount` in `src/lib/auth.functions.ts` (or a dedicated `signup.functions.ts`), reusing `hashPassword`/`startSession` from `guard.server.ts` and the existing OTP constants (5 min TTL, 3 attempts, 60 s cooldown, 5/hour).
- OTP code generation stays server-side; only the SHA-256 hash of `email:code` is stored, unchanged.
- `d1.server.ts` keeps its current `transaction()` helper (multi-statement, inlined literals); the signup batch is built as one `Statement[]`.
- `signUp` and `completeSignup` remain exported for any other caller, but the signup route stops using them.
- Background email uses a non-awaited send with its own error logging, so a mail failure can never fail verification.
- Existing rate-limit behaviour, lockouts and reset flows are untouched.

And let config our D1 DB and also smtp" and verify admin login info and make sure everything intact while mentain our guideline without depreciate nothing and improve as we analyze 