# Private profile photos

Settings and the member header use `/api/avatar`. It always serves the authenticated member's current photo; there is no public/member-ID read route or admin bypass. The generic private-file endpoint rejects the reserved `avatars/` namespace.

The existing private R2 bucket is unchanged. D1's additive `profile_avatars` and `avatar_operations` tables are created lazily and store references, byte counts, timestamps and retry receipts, never image data. Existing account rows need no migration or backfill.

Uploads accept still JPEG, PNG and WebP, at most 5MiB, 16 million pixels and 8192 pixels on either axis. Sharp validates the decoded format, strips metadata, auto-orients and re-encodes to WebP within a 512-pixel square. Processing is capped at two concurrent operations per server and five seconds per decoder. R2 PUTs have a 30-second timeout. Per member, at most 20 new operations/day and 40 retained object slots are allowed; reusing an operation ID never consumes another slot.

Changes use an atomic expected-revision check plus an operation receipt. Storage must succeed before the current reference changes. A lost PUT or database response does not trigger deletion. The browser's Retry action retains the original operation ID, image and expected revision. Failed replacements leave the displayed photo unchanged; refresh reads the authoritative current reference.

Cleanup runs on photo mutations only. Pending operations older than 24 hours are terminally expired before deletion; committed/superseded objects older than 24 hours are deleted only when unreferenced. Operations cannot be retried after an hour unless already committed. Tombstones remain to prevent old retries from restoring removed photos. Failed deletes retain metadata for later retry. No bucket enumeration, public CDN, financial writes or cleanup of current/deactivated-account photos is performed. Dormant accounts' obsolete objects wait until their next photo mutation.

All avatar responses use private/no-store policies; image bytes are excluded from the service worker's fixed asset cache. Writes require a custom header and reject cross-site browser requests.

## Verification

`node --test tests/avatar.test.mjs` uses in-memory SQLite, mocked R2 and actual Sharp decoding. It never writes to Cloudflare. Actual R2 integration testing requires separately approved controlled resources.

Coolify's existing Node server build (`NITRO_PRESET=node_server`) is required. The Docker runtime uses Debian to match the build image's glibc Sharp/libvips binaries; do not revert only the runtime to Alpine. A successful default Cloudflare-target build is not proof of native Sharp runtime compatibility.
