import { test } from "node:test";
import assert from "node:assert/strict";
import { associations, appId } from "../scripts/native-passkey-associations.mjs";
import { androidPasskeyOrigins } from "../src/lib/passkey-origins.ts";

test("public signing fingerprints produce exact Android trust and verification origins", () => {
  const fingerprint = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const result = associations({ androidSha256: [fingerprint, fingerprint], appleAppIds: [`ABCDE12345.${appId}`] });
  assert.equal(result.assetlinks.length, 1);
  assert.deepEqual(result.assetlinks[0].relation, ["delegate_permission/common.get_login_creds"]);
  assert.deepEqual(result.assetlinks[0].target.sha256_cert_fingerprints, [fingerprint]);
  assert.equal(result.assetlinks[0].target.package_name, appId);
  assert.deepEqual(result.apple.webcredentials.apps, [`ABCDE12345.${appId}`]);
  assert.deepEqual(result.androidOrigins, ["android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"]);
  assert.deepEqual(androidPasskeyOrigins(result.androidOrigins.join(",")), result.androidOrigins);
});

test("missing, malformed and unrelated identities cannot generate associations", () => {
  for (const input of [
    {}, { androidSha256: ["*"] }, { androidSha256: ["00:01"] },
    { appleAppIds: ["ABCDE12345.com.other.app"] }, { appleAppIds: ["*.com.scousgiftcardexchange.app"] },
    { androidSha256: "not-an-array" },
  ]) assert.throws(() => associations(input));
});

test("native verifier allowlist rejects wildcards, HTTPS origins, padding and noncanonical hashes", () => {
  assert.deepEqual(androidPasskeyOrigins(), []);
  for (const value of ["*", "https://scousgiftcardexchange.com", "android:apk-key-hash:*",
    `android:apk-key-hash:${"A".repeat(43)}=`, `android:apk-key-hash:${"A".repeat(42)}B`]) {
    assert.throws(() => androidPasskeyOrigins(value));
  }
});
