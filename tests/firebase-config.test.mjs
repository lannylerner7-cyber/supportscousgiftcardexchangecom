import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {androidFirebaseConfig, validateMessagingAccount, firebaseProjectId, androidPackage} from "../scripts/firebase-config.mjs";

const client = () => ({
  project_info: {project_id: firebaseProjectId, project_number: "123456789"},
  client: [{
    client_info: {mobilesdk_app_id: "1:123456789:android:test", android_client_info: {package_name: androidPackage}},
    api_key: [{current_key: "synthetic-client-key"}],
  }],
});
test("Android Firebase build input is limited to approved client fields", () => {
  const value = client();
  value.extra = {private_key: "DO_NOT_PACKAGE"};
  value.client[0].extra = {private_key: "DO_NOT_PACKAGE"};
  const result = JSON.stringify(androidFirebaseConfig(JSON.stringify(value)));
  assert.ok(result.includes(androidPackage));
  assert.ok(!result.includes("DO_NOT_PACKAGE"));
  assert.ok(!result.includes("private_key"));
});
test("Android build rejects wrong project, package, sender and service-account input", () => {
  for (const alter of [
    value => {value.project_info.project_id = "another-project";},
    value => {value.client[0].client_info.android_client_info.package_name = "com.other.app";},
    value => {value.project_info.project_number = "bad";},
    value => {value.client[0].client_info.mobilesdk_app_id = "1:wrong:android:test";},
    value => {value.client[0].api_key = [];},
    value => {value.private_key = "DO_NOT_PACKAGE";},
    value => {value.client.push(value.client[0]);},
  ]) {
    const value = client();
    alter(value);
    assert.throws(() => androidFirebaseConfig(JSON.stringify(value)));
  }
});
test("Malformed Firebase input never reveals secret excerpts", () => {
  for (const check of [androidFirebaseConfig, validateMessagingAccount]) {
    for (const raw of [undefined, "DO_NOT_LOG_THIS", "{bad: DO_NOT_LOG_THIS", "null", "[]"]) {
      assert.throws(() => check(raw), error => !error.message.includes("DO_NOT_LOG_THIS"));
    }
  }
});
test("Messaging key validates project, service-account identity and RSA structure", () => {
  const {privateKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
  const value = {
    type: "service_account", project_id: firebaseProjectId,
    client_email: `test-only@${firebaseProjectId}.iam.gserviceaccount.com`,
    private_key: privateKey.export({type: "pkcs8", format: "pem"}),
  };
  assert.doesNotThrow(() => validateMessagingAccount(JSON.stringify(value)));
  assert.throws(() => validateMessagingAccount(JSON.stringify({...value, project_id: "other-project"})));
  assert.throws(() => validateMessagingAccount(JSON.stringify({...value, client_email: "other@example.com"})));
  assert.throws(() => validateMessagingAccount(JSON.stringify({...value, private_key: "INVALID_PRIVATE_KEY"})),
    error => !error.message.includes("INVALID_PRIVATE_KEY"));
});
