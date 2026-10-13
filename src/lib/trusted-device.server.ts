import { getCookie, setCookie } from "@tanstack/react-start/server";
import { execute, queryOne, nowIso } from "./d1.server";
import { sha256Hex } from "./guard.server";

export const TRUST_SECONDS = 30 * 24 * 60 * 60;
const NAME = "scous_device";
const options = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };

export async function forgetDevice() {
  const token = getCookie(NAME);
  if (token) await execute("DELETE FROM trusted_devices WHERE token_hash=?", [await sha256Hex(token)]);
  setCookie(NAME, "", { ...options, maxAge: 0 });
}

export async function trustedDevice(userId: string, credentialTag: string) {
  const token = getCookie(NAME);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return queryOne<{ token_hash: string; expires_at: string }>(
    `SELECT token_hash,expires_at FROM trusted_devices
     WHERE token_hash=? AND user_id=? AND credential_tag=? AND expires_at>?`,
    [await sha256Hex(token), userId, credentialTag, nowIso()],
  );
}

export async function rememberDevice(userId: string, credentialTag: string, sessionId: string) {
  await forgetDevice();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const expires = new Date(Date.now() + TRUST_SECONDS * 1000).toISOString();
  const tokenHash = await sha256Hex(token);
  await execute(`INSERT INTO trusted_devices(token_hash,user_id,credential_tag,expires_at,created_at)
    SELECT ?,s.user_id,k.credential_tag,?,? FROM sessions s
    JOIN session_security k ON k.session_id=s.id JOIN profiles p ON p.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND k.verified=1 AND k.credential_tag=?
      AND s.expires_at>? AND p.deleted_at IS NULL`,
    [tokenHash, expires, nowIso(), sessionId, userId, credentialTag, nowIso()]);
  if (!await queryOne("SELECT token_hash FROM trusted_devices WHERE token_hash=?", [tokenHash]))
    throw new Error("Your session ended. Please sign in again.");
  setCookie(NAME, token, { ...options, maxAge: TRUST_SECONDS });
  return expires;
}
