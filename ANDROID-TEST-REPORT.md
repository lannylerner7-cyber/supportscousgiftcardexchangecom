# Android and Firebase evidence

Checked on 2026-10-08. This is an interim report: real-device validation remains
blocked, so the Android/Firebase validation milestone is not complete.

## Passed

- Both Firebase inputs validate against project `scousgiftcardexchange`; the
  Android client matches `com.scousgiftcardexchange.app`.
- Google OAuth accepted the supplied messaging service-account credentials.
  No FCM notification was sent, and no test data or financial records were changed.
- All 43 automated tests passed, including project/package rejection, malformed
  input redaction and preventing service-account fields from entering Android
  client configuration. These tests are not native-device tests.
- `pnpm --filter @workspace/scous-exchange run native:apk` completed successfully.
  Toolchain: OpenJDK 21.0.7, SDK platform 36, build-tools 36.0.0, Gradle 8.14.3.
- APK signature verification passed with Android `apksigner` (v2 scheme).
- Compiled package is `com.scousgiftcardexchange.app`, version name `1.0.0`,
  version code `1`, minimum SDK `24`, target SDK `36`.
- Compiled manifest declares notification permission and FCM receive support.
- APK content checks found no backend service-account email/private-key material
  and confirmed the trusted HTTPS server target and disabled cleartext setting.

## Build artifact

Path: `android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256:
`243c0ee7a695b9b548a957509f6a2c2086686fbb194abd6c4c7943aae869443c`

This is a debug-signed APK for controlled testing, not a Play Store release.
The existing remote-hosted Capacitor configuration is still test-only.
The APK loads `https://scousgiftcardexchange.com`; a successful native compile
does not establish which frontend/backend version Coolify is serving.

## Blocked or not verified

- **Updated Coolify application:** public homepage/main bundle checks did not
  find the new advert or native-runtime markers. The required native code must
  be deployed and verified through the existing Coolify rollout work.
- **Coolify Firebase configuration:** credentials saved in this workspace do not
  establish that the production backend has them.
- **Device access:** the owner has an Android phone, but `adb devices -l` listed
  no attached device. No emulator or physical-device journey was executed.
- **FCM delivery:** Firebase API enablement, sending permissions and actual
  receipt/open behavior in foreground, background and terminated states are
  unverified. Valid OAuth credentials are not proof of these.
- **Phone flows:** session persistence/revocation, photo permission denial,
  interrupted-upload retry, back/keyboard behavior, token changes and all-device
  opt-out still need controlled device evidence.

Do not run tests against real members, send unsolicited alerts, or mutate real
wallets. Before device testing, confirm controlled test-account use and a safe
device-access method. Do not expose Android debugging ports to the public internet.

## Release-only exclusions

No release AAB or iOS archive, store submission, paid service, production
architecture change, or deletion-policy change was performed. Production
packaging, signing, deletion-policy approval, store disclosures and iOS/APNs
verification remain separate requirements.
