import {writeFileSync, existsSync, readFileSync, chmodSync} from "node:fs";
import {androidFirebaseConfig, validateMessagingAccount} from "./firebase-config.mjs";

try {
  const destination = new URL("../android/app/google-services.json", import.meta.url);
  const raw = process.env.GOOGLE_SERVICES_JSON ??
    (existsSync(destination) ? readFileSync(destination, "utf8") : undefined);
  const config = androidFirebaseConfig(raw);
  if (process.argv.includes("--check-server")) {
    validateMessagingAccount(process.env.FCM_SERVICE_ACCOUNT_JSON);
    console.log("Messaging service-account structure and project match verified; network permissions and delivery are not yet verified.");
  }
  if (!process.argv.includes("--check-only")) {
    writeFileSync(destination, JSON.stringify(config, null, 2) + "\n", {mode: 0o600});
    chmodSync(destination, 0o600);
    console.log("Prepared ignored Android Firebase client configuration. No server credentials were written.");
  } else {
    console.log("Android Firebase client structure, project and package match verified.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
