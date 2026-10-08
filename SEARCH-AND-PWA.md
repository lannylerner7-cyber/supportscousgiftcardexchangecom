# Search and phone installation

The owner-provided Coolify origin https://scousgiftcardexchange.com was verified
over HTTPS. This is not a Replit-hosted production deployment.
The single canonical origin is defined in the public-site helper.

Only home, rates, support, privacy and terms are in the public sitemap.
Production indexing requires NODE_ENV=production and a request URL on that exact
hostname. All other environments and nonpublic application routes return
X-Robots-Tag: noindex, nofollow, noarchive. Private routes retain authentication.
Robots exclusions are not a security control. Auth/account routes are allowed to
be crawled only so crawlers can observe their noindex headers; they are not in the
sitemap. APIs and server functions are disallowed.

## Coolify verification before search submission

This work does not deploy anything. After the approved rollout, inspect response
headers on the actual production domain. Confirm the proxy preserves the original
request URL hostname and NODE_ENV is production. A misconfigured proxy fails
closed (noindex) rather than indexing a preview host. Check robots.txt and confirm
sitemap.xml lists exactly the five public HTTPS URLs; login and private routes
must remain noindex. Do not solve this by removing noindex globally.

Use the owner's Google Search Console account to verify the domain (DNS changes
require separate authorization), submit /sitemap.xml, and inspect public URLs.
Google decides indexing and rankings. No submission or indexing is claimed here.

## PWA

The home and support pages register /sw.js and provide installation guidance.
Supporting Android browsers show an install action when eligible. On iPhone use
Safari > Share > Add to Home Screen. Embedded preview frames may not offer an
installation prompt; verify in a top-level HTTPS tab and on target devices.
The manifest is not an Android APK/AAB or an iOS app-store package.

Only the generic offline page and three public install icons are precached.
No fetched page, API response, card image, user profile, balance or mutation is
written to Cache Storage. Offline navigation receives a generic reconnect page,
not a cached account screen. API requests fail normally when offline.
Cache version changes remove only this app's obsolete installation caches.
An available update waits for the user to finish work and choose Update and reload.

Device installation, iPhone standalone launch and OS integration need a real-device
check after rollout. The automated tests validate the worker's request/cache
policy and PNG dimensions; they do not claim actual OS installation.
