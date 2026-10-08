# GitHub import

- Source: https://github.com/lannylerner7-cyber/supportscousgiftcardexchangecom.git
- Branch: `main`
- Revision: `c3e6142e6990df334dcf44ece368dd4c44975fd8`
- Imported: 2026-10-08
- All 221 tracked files imported; no submodules or Git LFS pointers found.
- Git metadata was intentionally excluded to preserve the Replit repository.

## Compatibility changes

The package name uses the workspace prefix, a typecheck script was added, and Vite listens on the managed port with proxy-compatible host settings. All other upstream files, including Dockerfile, Docker Compose, Bun lockfile, application source, and schema, were preserved byte-for-byte at import.

The app owns its TanStack Start server and API routes. The starter API service is restricted to `/api/healthz` so it does not intercept the imported API. Replit metadata uses the Node server output rather than serving SSR as a static site. The existing Coolify hosting has not been modified.

## Verification

- TypeScript check passes.
- Node-target production build completes.
- Development server runs through the managed workflow.
- Browser capture renders the existing branded loading screen; the capture did not verify the fully revealed homepage or signed-in UI.
- `/api/public/health` reaches the imported server and returns HTTP 503 with database down and storage/email not configured, as expected without credentials.

## Configuration still required

No production secrets, database records, or private uploads were downloaded. Do not copy `.env.example` into an active environment without replacing production references with approved development resources.

- Separate development Cloudflare D1 credentials and database/account identifiers.
- Separate private R2 storage and credentials.
- Development email service or SMTP configuration and sender identity.
- Development app URL for email links; use a development session secret, not the production signing key.

Use secure integration/secret setup, never commit credentials. Existing auth and business logic were not replaced. Login, OTP delivery, trading, balances, uploads, and admin actions still need configuration and end-to-end verification before final finishing can be considered complete.
