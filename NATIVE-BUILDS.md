# Native build preparation — test harness, not store-ready

## Current boundary

The owner confirmed `com.scousgiftcardexchange.app`, Google Play and Apple
developer accounts, Firebase support with connection later, and Apple setup
later. They explicitly retained deactivation only for now.

Android and iOS Capacitor 8 projects are generated. Native scripts, branded
launcher/splash assets, photo controls, strict member-route deep links,
foreground session revalidation, generic native push senders and registration
are implemented. An Android debug APK was compiled and its APK signature checked
on 2026-10-08; see `ANDROID-TEST-REPORT.md` for evidence and remaining blockers.
It is not device-tested or store-ready. No release AAB, IPA or Xcode archive was
produced. This Linux workspace now has JDK 21 and Android SDK 36; it cannot run Xcode.

**Production architecture remains unresolved.** The existing app is TanStack
SSR, not a static SPA. Do not put `.output/` in Capacitor's webDir. The generated
test harness uses a trusted HTTPS remote server URL to exercise the existing
backend. Capacitor documents `server.url` as not intended for production:
https://capacitorjs.com/docs/config . This configuration is not a validated
store-distribution approach. Before a release, implement a bundled native
client using authenticated backend APIs or evaluate a production-supported
remote-container architecture. That is a separate, consequential architecture
decision, not permission to migrate D1/R2 or rewrite the entire app.

Apple requires actual account deletion, not just temporary deactivation:
https://developer.apple.com/support/offering-account-deletion-in-your-app/ .
The current owner-approved retention policy is unchanged. Do not submit this
as App Store-ready or assume a support email alone satisfies review.

## Backend and migration

The harness loads only `https://scousgiftcardexchange.com`; it never uses a
Replit preview or a broad navigation wildcard. Coolify must serve the updated
web bundle/backend before native features can appear in the harness. Existing
Coolify rollout work covers that deployment; this preparation does not deploy it.

Run `node scripts/apply-native-migration.mjs` to inspect, or `--apply` against
the confirmed target. This adds two native-push tables and one index, no financial
or catalogue changes. Applied to the approved shared D1 for preparation.
Native registrations are bound to revocable sessions; logout, closure and session
removal invalidate delivery. Global notification opt-out removes both web/native
registrations. Cookies remain HttpOnly, Secure and server checked. Native code
does not copy cookies into localStorage or use a separate token bypass.

Only production-origin delivery runs native jobs; missing provider configuration
does not attempt delivery. Queues deduplicate device/event pairs, use leases,
backoff and five attempts. Payloads are generic and collapse by event. At-least-once
transport retries are possible. Provider acknowledgement is not proof of receipt.

## Native push configuration

Use secure deployment/CI secrets, never source files or chat.

**Android:** create/use an owner-controlled Firebase project and register the
confirmed package. Add the client `google-services.json` at `android/app/` locally
or through CI (ignored by Git). Give the backend a least-privilege Firebase
messaging service account via `FCM_SERVICE_ACCOUNT_JSON`. The owner supplied both
configurations for Firebase project `scousgiftcardexchange` through workspace
Secrets. `GOOGLE_SERVICES_JSON` contains the Android client configuration.
`pnpm native:firebase` validates the project/package and materializes only
whitelisted client fields into the ignored Android file. Android build scripts
run this check before building. Server credentials are never written into it.
`pnpm native:firebase:check` checks both JSON structures, and
`pnpm native:firebase:auth` verifies Google accepts the backend credentials without
sending a notification. Neither command proves FCM delivery permissions or receipt.
Workspace secrets do not configure Coolify: configure that backend separately
through its secure environment settings as part of the approved rollout.
No billing/account creation has been performed. The app asks permission only when the member enables
notifications. Android 13+ notification permission is declared. Android channel:
`scous_updates`.

**iOS:** enable Push Notifications for the bundle ID and regenerate matching
provisioning profiles. Configure backend `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_PRIVATE_KEY`, and `APNS_ENVIRONMENT` (`sandbox` or `production`).
An App Store Connect API key is not automatically an APNs key or a signing
certificate. The application entitlement uses `SCOUS_APNS_ENVIRONMENT`
(`development` for debug/sandbox; `production` for distribution).
Keep backend and signing environments consistent. AppDelegate forwards the
APNs registration callbacks. No Apple credentials were requested or stored.

## Android outputs

Install JDK 21, Android SDK 36/build tools 36.0.0 and configure `ANDROID_HOME` or the
ignored android/local.properties. In this workspace, the official Android
command-line SDK is installed under `/home/runner/.cache/scous-android-sdk`;
`ANDROID_HOME` points there in development. This cache is not committed or
guaranteed to exist in a fresh checkout. On another build host install the same
SDK packages with the official `sdkmanager`, accept the applicable licenses,
and configure the Firebase client input through secure build configuration.
The checked-in Gradle wrapper selects Gradle 8.14.3. From this package directory:

```
pnpm native:sync
pnpm native:apk
# output: android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is only for device testing. For a release AAB, set secure
`SCOUS_ANDROID_KEYSTORE`, `SCOUS_ANDROID_STORE_PASSWORD`,
`SCOUS_ANDROID_KEY_ALIAS`, `SCOUS_ANDROID_KEY_PASSWORD`, then:

```
pnpm native:aab
# output: android/app/build/outputs/bundle/release/app-release.aab
```

Release scripts refuse missing signing configuration. They do not use debug
signing as a release fallback. Keep the upload key under owner control; use Play
App Signing as appropriate. Build version is 1, version name 1.0.0; increase both
platform build numbers before subsequent uploads. The debug APK was produced;
the release AAB path remains an expected future output, not a built artifact.

## iOS outputs

On a Mac with compatible Xcode and the owner's signing setup:

```
pnpm native:sync
pnpm exec cap open ios
```

Choose the owner Team, verify capabilities and profiles, and test on a device.
Or set `SCOUS_APPLE_TEAM_ID` and `SCOUS_APNS_ENVIRONMENT`, then `pnpm native:ios`
to archive. Expected output: native-output/ScousExchange.xcarchive. Use Xcode
Organizer to validate/export/upload to TestFlight after resolving release
readiness, signing, privacy labels and deletion policy. No automatic submission.
Minimum iOS is 16.4; Android minimum SDK is 24, with an up-to-date system WebView.

## Device verification still required

- Sign-in/OTP, force-close/relaunch cookie persistence, sign-out and admin closure
  revocation. Old sessions must not return after reactivation.
- Camera and limited photo-library permission denial/selection. Only explicit
  selections upload; saveToGallery is false, temporary Camera file copies are
  deleted after reading, and photos remain memory-only in the web UI.
- Loss of network during card submission; resume the same trade from history,
  reselect photos after a process kill, and verify no duplicate trade/image.
  Existing upload idempotency is unchanged; unsaved photos are not cached offline.
- Safe areas, keyboard, back navigation and external HTTPS links in system
  browser. `scousgiftcardexchange://app/settings` and other allowed member routes
  are testable custom links, not verified Universal Links/App Links. Verified
  associations need owner team/signing fingerprints and domain files later.
- Foreground/background/terminated-state native push on Android and iPhone;
  permission denial, token rotation, logout and all-device opt-out.
- Review collected-data disclosures and required-reason manifests for every
  plugin before submission. Included timestamp reason is not a complete store
  privacy questionnaire or legal retention policy.

Web typechecks/builds/unit tests do not replace these device checks.
