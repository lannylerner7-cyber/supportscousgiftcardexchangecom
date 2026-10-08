import {sign} from "node:crypto";
import {validateMessagingAccount} from "./firebase-config.mjs";

// Authorization probe only: no device token, notification, or database mutation.
try {
  validateMessagingAccount(process.env.FCM_SERVICE_ACCOUNT_JSON);
  const account = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({alg: "RS256", typ: "JWT"})}.${encode({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const assertion = `${input}.${sign("RSA-SHA256", Buffer.from(input), account.private_key).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion}),
  });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== "string")
    throw Error("authorization failed");
  console.log("Google accepted the messaging service-account credentials. No notification was sent.");
  console.log("FCM API/IAM delivery permission and device receipt still require a controlled device test.");
} catch {
  // Neither Google responses nor underlying credential/parser exceptions are safe to log.
  console.error("FCM authorization check failed. Check the service-account key, project access and network connectivity.");
  process.exitCode = 1;
}
