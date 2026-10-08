import {createPrivateKey} from "node:crypto";

export const firebaseProjectId = "scousgiftcardexchange";
export const androidPackage = "com.scousgiftcardexchange.app";

function parseConfig(raw, label) {
  try {
    const value = JSON.parse(raw ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch {
    // JSON parser errors can contain credential excerpts. Never forward them.
    throw Error(`${label} must contain a complete JSON object.`);
  }
}

export function androidFirebaseConfig(raw) {
  const value = parseConfig(raw, "GOOGLE_SERVICES_JSON");
  const project = value.project_info;
  if (value.private_key || value.type === "service_account")
    throw Error("A service-account key cannot be used as Android client configuration.");
  if (project?.project_id !== firebaseProjectId || !/^\d+$/.test(project.project_number ?? ""))
    throw Error("Android Firebase configuration must match the approved Scous project.");
  const clients = Array.isArray(value.client) ? value.client.filter(
    client => client.client_info?.android_client_info?.package_name === androidPackage,
  ) : [];
  if (clients.length !== 1) throw Error("Firebase configuration must contain exactly one matching Scous Android client.");
  const client = clients[0];
  const appId = client.client_info?.mobilesdk_app_id;
  const apiKey = client.api_key?.[0]?.current_key;
  if (typeof appId !== "string" || !appId.startsWith(`1:${project.project_number}:android:`) ||
      typeof apiKey !== "string" || !apiKey.trim())
    throw Error("Android Firebase app ID or client API key is missing or invalid.");
  // Deliberately whitelist FCM client fields. Never copy arbitrary secret JSON into an APK.
  return {
    project_info: {project_number: project.project_number, project_id: firebaseProjectId},
    client: [{
      client_info: {mobilesdk_app_id: appId, android_client_info: {package_name: androidPackage}},
      api_key: [{current_key: apiKey}],
    }],
    configuration_version: "1",
  };
}

export function validateMessagingAccount(raw) {
  const value = parseConfig(raw, "FCM_SERVICE_ACCOUNT_JSON");
  if (value.type !== "service_account" || value.project_id !== firebaseProjectId ||
      typeof value.client_email !== "string" ||
      !value.client_email.endsWith(`@${firebaseProjectId}.iam.gserviceaccount.com`))
    throw Error("Messaging credentials must be a service account for the approved Scous Firebase project.");
  try {
    if (createPrivateKey(value.private_key).asymmetricKeyType !== "rsa") throw Error();
  } catch {
    throw Error("Messaging credentials do not contain a valid RSA private key.");
  }
}
