import { getCookie, setCookie } from "@tanstack/react-start/server";
import { execute, query, queryOne, nowIso } from "./d1.server";
import { sha256Hex } from "./guard.server";

export const TRUST_SECONDS = 30 * 24 * 60 * 60;
const NAME = "scous_device";
const options = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };

// Separate random handles support existing enrollments without exposing a
// credential digest or changing their fixed expiry. DDL is additive/idempotent.
async function ensureDeviceHandles(userId: string) {
  await execute(`CREATE TABLE IF NOT EXISTS trusted_device_handles (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE REFERENCES trusted_devices(token_hash) ON DELETE CASCADE
  )`);
  await execute(`INSERT OR IGNORE INTO trusted_device_handles(id,token_hash)
    SELECT lower(hex(randomblob(16))),token_hash FROM trusted_devices
    WHERE user_id=? AND expires_at>?`, [userId, nowIso()]);
}

export async function listRememberedDevices(userId: string) {
  await ensureDeviceHandles(userId);
  const token = getCookie(NAME);
  const currentHash = token ? await sha256Hex(token) : "";
  const rows = await query<{ id: string; created_at: string; expires_at: string; is_current: number }>(
    `SELECT h.id,d.created_at,d.expires_at,(d.token_hash=?) AS is_current
     FROM trusted_devices d JOIN trusted_device_handles h ON h.token_hash=d.token_hash
     WHERE d.user_id=? AND d.expires_at>? ORDER BY d.created_at DESC,h.id`,
    [currentHash, userId, nowIso()],
  );
  return rows.map(row => ({
    id: row.id,
    label: row.is_current ? "This browser or app" : "Remembered browser or app",
    current: Boolean(row.is_current),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

export async function revokeRememberedDevices(userId: string, id: string | null) {
  await ensureDeviceHandles(userId);
  const token = getCookie(NAME);
  const currentHash = token ? await sha256Hex(token) : "";
  const selectedCurrent = id === null || Boolean(await queryOne(
    `SELECT h.id FROM trusted_device_handles h JOIN trusted_devices d ON d.token_hash=h.token_hash
     WHERE h.id=? AND d.user_id=? AND d.token_hash=?`, [id, userId, currentHash],
  ));
  // Ownership is enforced on the mutation itself, including replayed/stale IDs.
  await execute(`DELETE FROM trusted_devices WHERE user_id=?${id === null ? "" :
    " AND token_hash IN (SELECT token_hash FROM trusted_device_handles WHERE id=?)"}`,
    id === null ? [userId] : [userId, id]);
  if (selectedCurrent) setCookie(NAME, "", { ...options, maxAge: 0 });
  return { ok: true };
}

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
