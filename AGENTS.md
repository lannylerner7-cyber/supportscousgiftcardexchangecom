<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- All application data lives in the owner's Cloudflare D1 database, reached from
  server code only via `src/lib/d1.server.ts` (Cloudflare API through the
  connector gateway). No ORM, no other database client.
  Why: the owner requires the app to run on infrastructure they control.
- `src/db/schema.sql` is the single source of truth for the schema; changes are
  applied to D1 by running its statements, never by ad-hoc table edits.
  Why: the live database must always be reproducible from the repo.
- Money is stored as INTEGER kobo and converted only at the D1 boundary with
  `toNaira`/`toKobo`; amounts are never trusted from the browser.
  Why: avoids floating-point drift and client-side tampering.
- D1 has no row-level security, so every read and write is authorised in server
  code via `src/lib/guard.server.ts` (`requireUserId` / `requireAdminId`); the
  admin role is always read from `user_roles`.
  Why: the database itself cannot enforce per-row access.
- Uploaded images go to the private R2 bucket via `src/lib/r2.server.ts` and are
  served through `/api/files/*` after an ownership check.
  Why: card photos and chat images must never be publicly reachable.
- Multi-step money operations run through `transaction()` in `d1.server.ts`
  (D1's multi-statement endpoint, all-or-nothing).
  Why: balances and ledger lines must never diverge.
- Outgoing email goes through Cloudflare Email Service's HTTPS API via the
  Cloudflare connector (`sendEmail` in `src/lib/email.server.ts`); SMTP is only a
  fallback when that connection is absent.
  Why: the live server cannot open SMTP connections to Cloudflare's mail hosts.
- Passwords are hashed with PBKDF2 at 100,000 rounds; older 120,000-round hashes
  are verified in plain JS and re-saved on the next sign-in.
  Why: the live server's built-in PBKDF2 refuses more than 100,000 rounds.
