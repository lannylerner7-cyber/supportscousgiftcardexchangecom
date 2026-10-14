import { createHash } from "node:crypto";
import { getCookie, setCookie, getRequestHeader } from "@tanstack/react-start/server";
import { queryOne, execute } from "./d1.server";

export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const enabled = () => process.env["PASSKEY_ENABLED"] === "true";
export function config() {
  if (!enabled()) throw new Error("Passkeys are not enabled yet. Continue with password.");
  const rpID = process.env["PASSKEY_RP_ID"] || "scousgiftcardexchange.com";
  const origins = (process.env["PASSKEY_ORIGINS"] || "https://scousgiftcardexchange.com").split(",").map(s => s.trim());
  if (!/^[a-z0-9.-]+$/.test(rpID) || origins.some(s => {
    const u = new URL(s);
    return u.origin !== s || u.protocol !== "https:" || !(u.hostname === rpID || u.hostname.endsWith("." + rpID));
  })) throw new Error("Passkey origin configuration is invalid.");
  return { rpID, origins };
}
export function checkOrigin() {
  const c = config();
  if (!c.origins.includes(getRequestHeader("origin") || ""))
    throw new Error("Open the configured Scous website to use passkeys.");
  return c;
}
const cookie = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };
export function binding(create = false) {
  let value = getCookie("scous_passkey_binding");
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    if (!create) throw new Error("Passkey request expired. Please retry.");
    value = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    setCookie("scous_passkey_binding", value, { ...cookie, maxAge: 600 });
  }
  return digest(value);
}
/** Atomic fixed-window limit; global cap bounds attacks rotating pre-auth cookies. */
export async function throttle(key: string, maximum: number) {
  const window = Math.floor(Date.now() / 60000);
  const row = await queryOne(`INSERT INTO passkey_limits(key,window,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window=excluded.window,
      count=CASE WHEN passkey_limits.window=excluded.window THEN passkey_limits.count+1 ELSE 1 END
    WHERE passkey_limits.window!=excluded.window OR passkey_limits.count<?
    RETURNING count`, [key, window, maximum]);
  if (!row) throw new Error("Too many passkey requests. Wait a minute and retry, or continue with password.");
}
export async function limitRequest() {
  checkOrigin();
  await throttle("global", 3000);
  const bound = binding(true);
  await throttle("browser:" + bound, 20);
  return bound;
}
export async function cleanExpired() {
  await execute("DELETE FROM passkey_challenges WHERE id IN (SELECT id FROM passkey_challenges WHERE expires_at<? LIMIT 100)", [new Date().toISOString()]);
  await execute("DELETE FROM passkey_limits WHERE key IN (SELECT key FROM passkey_limits WHERE window<? LIMIT 100)", [Math.floor(Date.now()/60000)-10]);
}
export function responseJSON(value: unknown) {
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 24000)
    throw new Error("Invalid passkey response.");
  return value;
}
