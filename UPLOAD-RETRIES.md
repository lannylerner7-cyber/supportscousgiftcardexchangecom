# Gift-card submission recovery

No database migration is required. This implementation uses the existing primary
keys and the existing free-text image `kind` column. Do not rerun the full schema
against production: its catalogue statements also modify catalogue data.

## Identity and recovery

- Trade identity is SHA-256 of the authenticated user and a browser-generated
  submission UUID. Atomic insert-on-conflict and a deterministic notification ID
  prevent concurrent duplicate records. Reuse with changed card details fails.
- Browsers retain only the UUID and saved trade ID, scoped to the signed-in user.
  Card codes, PINs and file bytes are not stored in localStorage.
- Web Locks serialize same-user submission creation across tabs. Unsupported
  browsers or unavailable localStorage fail before a new network write.
- A page reload looks up the UUID on the server before offering the existing
  history page. Starting a genuinely separate card is an explicit user action.
- Each image identity is derived from its bytes **within that trade and owner**.
  The same photo on a separate intentional trade is not globally deduplicated.
- An `uploading` image row reserves one of five slots before any object write.
  Retrying uses the same object path and bytes; completion marks it `card`.
  Member/admin image lists hide incomplete reservations.
- An uncertain R2 or D1 response never triggers object deletion. Deleting then
  retrying could destroy a successful concurrent request. Every written object
  already has an owned reservation, so it remains recoverable rather than orphaned.
- Resume from history by selecting the original files again. Reserved slots count
  toward the limit, including unfinished files. If the original files are lost,
  contact support; automatic expiration/deletion of financial evidence is not safe.

## Rollout

Keep R2 private and existing Coolify credentials unchanged. Deploy the full source
change together: older builds do not recognize the incomplete-upload marker.
No live deployment or migration is performed by these source edits.

The request payload is checked for conflicting retries, and accepted results retain
the original rate even if catalogue pricing later changes.

## Verification

The node test suite exercises actual createTrade and upload handlers against
isolated SQLite and an in-memory object store, including concurrent submissions,
lost post-commit responses, uncertain R2 responses, capacity, isolation, MIME
fallback and replay after review. It does not claim a real-device HEIC decoding test.
