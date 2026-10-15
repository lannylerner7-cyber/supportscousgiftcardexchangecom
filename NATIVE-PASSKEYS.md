# Native passkeys — implementation prepared, device verification blocked

## Scope and current status

The owner chose “Neither yet—keep native passkeys disabled” when asked about
physical-device testing and did not provide public signing identifiers. The
accepted delivery is disabled-by-default implementation preparation, not enabled
or device-verified native support. Signing setup, association publication and
physical-device acceptance are deferred until the owner is ready; they require
fresh authorization before any deployment or store submission.

The native test harness uses `@capgo/capacitor-passkey` 8.5.6 (maintained Capacitor
8 line), using Android Credential Manager and iOS AuthenticationServices. The
direct JSON API was chosen instead of globally patching `navigator.credentials`:
browser SimpleWebAuthn behavior stays unchanged, and native errors never silently
switch into a browser ceremony. Both transports use the existing server challenge,
signature, user-verification, session, account and revocation checks.

References:
- https://github.com/Cap-go/capacitor-passkey
- https://capgo.app/docs/plugins/passkey/

The bridge is **off by default**. It requires `VITE_NATIVE_PASSKEY_ENABLED=true`
in the web build AND the installed native plugin. Because this harness loads a
remote SSR app, the flag belongs to the authorized test website build, not merely
the APK/Xcode build. Do not enable it on the live site to test without approval.
The existing `PASSKEY_ENABLED` server flag and database prerequisites still apply.
Old app binaries without the plugin retain password fallback.

The bridge's runtime support check is not proof of biometric/provider readiness,
valid associations or successful sign-in. Native cancellation, provider absence
and unsupported devices return errors with password fallback still accessible.

No physical Android or iPhone has been tested. No website associations have been
published. No store submission, production configuration change, migration,
deployment or private signing material was performed/added. This remains a
remote-hosted test harness, not production-supported Capacitor packaging.

## Native app associations

`pnpm exec cap sync` installs the bridge into Android Gradle and iOS Swift Package
Manager. The plugin's native configuration hook maintains:

- Android `asset_statements` metadata including the domain's assetlinks URL.
- iOS `webcredentials:scousgiftcardexchange.com` Associated Domains entitlement.
  Keep the entitlements plist in standard multiline format; the hook uses
  line-based matching. Preserve the existing APNs entitlement.

The Apple App ID/provisioning profile must have Associated Domains enabled.
Syncing source does not enable that capability in an Apple developer account.
Use iOS 17.4+ as the first validation target (explicit HTTPS client-data origin);
older OS versions are **not verified**, even if the bridge reports availability.
Android needs a compatible credential provider and screen lock; test supported
OS/provider combinations rather than inferring readiness from Android version.

## Website associations: public identifiers needed

Obtain these public identifiers, not private keys or signing passwords:

- SHA-256 fingerprint of each authorized Android **app signing** certificate.
  For Play-distributed builds use the Play App Signing certificate, not the upload
  certificate. Only associate a debug signer on an explicitly approved test domain.
- Full Apple application identifier
  `APP_ID_PREFIX.com.scousgiftcardexchange.app` from the signed provisioning
  profile (the prefix is often, but not invariably, the Team ID).

Create a local JSON file with `androidSha256` and `appleAppIds` arrays containing
the approved real values. Empty arrays are allowed for one platform only. From
the app directory run:

```sh
node scripts/native-passkey-associations.mjs public-identifiers.json /tmp/scous-passkey-associations
```

The command validates identifiers, produces the two association files and prints
the exact public `PASSKEY_ANDROID_ORIGINS` configuration value. It does not read
private keys, contact a service, modify app trust automatically or deploy.

After review and explicit publishing approval, merge generated content with any
existing association files (do not overwrite unrelated app associations), and
serve from the RP domain:

- `/.well-known/assetlinks.json`
- `/.well-known/apple-app-site-association`

Both must return HTTP 200, JSON content type, no redirect or sign-in page. Check
the deployed responses and the platform's association verification before testing.
Grant only `delegate_permission/common.get_login_creds`; this feature does not
need Android URL-handling permission.

Set the generated `PASSKEY_ANDROID_ORIGINS` server value only through authorized
configuration. Exact canonical `android:apk-key-hash:<base64url SHA-256>` origins
are added to **credential verification only**. `PASSKEY_ORIGINS` and HTTP request
origin checks remain HTTPS-only. Never set the expected origin from client data
or permit a wildcard. iOS uses the configured HTTPS origin.

No production signing identifiers are guessed or embedded in this change.

## Required physical-device acceptance — all pending

Use dedicated test accounts/data and an approved HTTPS environment with matching
RP/domain associations and signed apps. Do not use real members or real OTP emails
without separate permission. Keep an existing password/OTP recovery route.

Record device/OS/provider, public signing fingerprint or Apple app identifier,
app version, tested website build and observed result, never private keys,
biometrics, challenge payloads, tokens or member data.

| Check on both Android and iPhone | Expected | Status |
| --- | --- | --- |
| Register after verified password login | Native prompt; one server credential; visible in Settings | Pending |
| Sign out, enter password and choose passkey verification | Correct member, no login OTP; remember option honored | Pending |
| Cancel registration and login | No new credential/session; retry works; password stays usable | Pending |
| Remove passkey from another session | Existing passkey session rejected; removed credential cannot log in | Pending |
| Remove key in OS/provider only | No-key handling; password recovery still usable | Pending |
| Password reset/change | Old credential rejected | Pending |
| App without bridge / disabled flag | Password fallback, no broken prompt | Pending |
| Wrong certificate / missing association | No successful enrollment or login | Pending |
| Relaunch app and repeat | Session expiry/remember behavior correct | Pending |

Do not claim native support or mark device verification complete based on Node
tests, a desktop virtual authenticator, `cap sync`, compilation or screenshots.

## Local verification

Observed in this workspace:
- TypeScript check passed.
- All 138 automated tests passed.
- Default web production build passed.
- Capacitor sync completed for Android and iOS; the formatted entitlements remained
  stable on repeat sync.
- The preview passkey page rendered with password fallback and no browser errors.
- Android Java compilation could not run: the configured Android SDK directory
  is absent in this fork. This is not a successful native build.
- `adb devices` reported no attached devices. iOS compilation requires macOS/Xcode;
  neither iOS compilation nor physical-device acceptance was performed.

```sh
pnpm typecheck
node --test tests/passkeys.test.mjs tests/native-passkey-associations.test.mjs tests/passkey-transport.test.mjs
pnpm exec cap sync
```

Tests use local mocks/SQLite and real synthetic EC signatures, not real devices.
The transport test uses the installed plugin's JavaScript wrapper and converter,
mocking only the native Capacitor adapter; it confirms authentication reaches that
adapter with JSON request options instead of being misclassified as registration.
They cover transport selection, disabled/missing bridge, unavailable provider,
configuration mismatch, cancellation mapping, association generation, exact Android
origin verification, HTTP-origin separation, credential revocation and the existing
browser passkey security cases.

Rollback: disable the web build flag and rebuild only with authorization. If
server passkeys must be disabled, use the existing server flag rollback in
PASSKEYS.md. Do not delete stored public credentials automatically.
