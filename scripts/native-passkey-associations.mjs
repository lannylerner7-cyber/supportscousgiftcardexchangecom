import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const appId = "com.scousgiftcardexchange.app";

/** Public identifiers only. Never read a keystore, certificate private key or credentials. */
export function associations({ androidSha256 = [], appleAppIds = [] }) {
  if (!Array.isArray(androidSha256) || !Array.isArray(appleAppIds)) throw new Error("Expected arrays of public signing identifiers.");
  if (!androidSha256.length && !appleAppIds.length) throw new Error("Supply at least one real public signing identifier.");
  const fingerprints = [...new Set(androidSha256)];
  if (fingerprints.some(s => typeof s !== "string" || !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(s))) {
    throw new Error("Android SHA-256 fingerprints must contain 32 uppercase hex bytes separated by colons.");
  }
  if (appleAppIds.some(s => typeof s !== "string" || !new RegExp(`^[A-Z0-9]{10}\\.${appId.replaceAll(".", "\\.")}$`).test(s))) {
    throw new Error(`Apple application identifiers must be APP_ID_PREFIX.${appId}.`);
  }
  return {
    assetlinks: fingerprints.length ? [{
      relation: ["delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: appId, sha256_cert_fingerprints: fingerprints },
    }] : [],
    apple: { webcredentials: { apps: [...new Set(appleAppIds)] } },
    androidOrigins: fingerprints.map(s => `android:apk-key-hash:${Buffer.from(s.replaceAll(":", ""), "hex").toString("base64url")}`),
  };
}

// Run from the app directory. Output must be explicitly chosen so a dry run
// cannot silently alter website associations or grant trust to a debug signer.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: node scripts/native-passkey-associations.mjs <public-identifiers.json> <output-directory>");
  const result = associations(JSON.parse(await readFile(input, "utf8")));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "assetlinks.json"), JSON.stringify(result.assetlinks, null, 2) + "\n");
  await writeFile(resolve(output, "apple-app-site-association"), JSON.stringify(result.apple, null, 2) + "\n");
  console.log(`PASSKEY_ANDROID_ORIGINS=${result.androidOrigins.join(",")}`);
  console.log("Review and merge with existing associations before publishing. No deployment performed.");
}
