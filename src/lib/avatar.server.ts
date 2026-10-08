import sharp from "sharp";
import { createHash } from "node:crypto";
import { execute, query, queryOne, transaction } from "./d1.server";
import { putObject, getObject, deleteObject } from "./r2.server";

export const AVATAR_LIMIT = 5 * 1024 * 1024;
let processing = 0;
export class AvatarError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
let schema: Promise<void> | undefined;
export function ensureAvatarSchema() {
  return schema ??= (async () => {
    await execute(`CREATE TABLE IF NOT EXISTS profile_avatars (
      user_id TEXT PRIMARY KEY, revision TEXT NOT NULL DEFAULT '', object_key TEXT,
      bytes INTEGER, updated_at TEXT NOT NULL)`);
    await execute(`CREATE TABLE IF NOT EXISTS avatar_operations (
      user_id TEXT NOT NULL, id TEXT NOT NULL, expected TEXT NOT NULL, digest TEXT NOT NULL,
      object_key TEXT, bytes INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, PRIMARY KEY(user_id,id))`);
    await execute("CREATE INDEX IF NOT EXISTS avatar_operations_age ON avatar_operations(user_id,created_at)");
  })().catch(error => { schema = undefined; throw error; });
}
export async function avatarState(user: string) {
  await ensureAvatarSchema();
  return await queryOne<{ revision: string; object_key: string | null }>(
    "SELECT revision,object_key FROM profile_avatars WHERE user_id=?", [user],
  ) ?? { revision: "", object_key: null };
}
export async function normalizeAvatar(bytes: Uint8Array, type: string) {
  if (!bytes.length || bytes.length > AVATAR_LIMIT) throw new AvatarError("Choose a photo between 1 byte and 5MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new AvatarError("Choose a JPG, PNG or WEBP photo.");
  if (processing >= 2) throw new AvatarError("Photo processing is busy. Please try again shortly.", 429);
  processing++;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" }).timeout({ seconds: 5 });
    const meta = await image.metadata();
    if (`image/${meta.format === "jpeg" ? "jpeg" : meta.format}` !== type ||
        !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || (meta.pages ?? 1) > 1)
      throw new Error("Unsupported image");
    // Re-encoding strips EXIF, GPS, profiles and other input metadata.
    return await image.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  } catch { throw new AvatarError("This photo is invalid, animated or too large to process. Use a still image up to 16 megapixels."); }
  finally { processing--; }
}

/** Terminal operations can never become current again. Retain tombstones for retry safety. */
export async function cleanupAvatars(user: string) {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  await execute("UPDATE avatar_operations SET state='expired' WHERE user_id=? AND state='pending' AND created_at<?", [user, cutoff]);
  const obsolete = await query<{ object_key: string }>(`SELECT object_key FROM avatar_operations
    WHERE user_id=? AND object_key IS NOT NULL AND state!='pending' AND created_at<?
    AND object_key NOT IN (SELECT object_key FROM profile_avatars WHERE object_key IS NOT NULL)
    ORDER BY created_at DESC LIMIT 40`, [user, cutoff]);
  for (const row of obsolete) {
    await deleteObject(row.object_key, true);
    await execute("UPDATE avatar_operations SET object_key=NULL WHERE user_id=? AND object_key=? AND state!='pending'", [user, row.object_key]);
  }
}

export async function changeAvatar(user: string, id: string, expected: string, bytes: Uint8Array | null, type: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || (expected !== "" && !/^[a-f0-9-]{36}$/.test(expected)))
    throw new AvatarError("Invalid photo operation.");
  await ensureAvatarSchema();
  // Also recover abandoned uploads when earlier requests never reached commit.
  try { await cleanupAvatars(user); } catch { console.error("Avatar cleanup deferred"); }
  const normalized = bytes ? await normalizeAvatar(bytes, type) : null;
  const digest = normalized ? createHash("sha256").update(normalized).digest("hex") : "remove";
  const key = normalized ? `avatars/${user}/${id}.webp` : null;
  await execute(`INSERT INTO avatar_operations(user_id,id,expected,digest,object_key,bytes,created_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM avatar_operations WHERE user_id=? AND created_at>?)<20
    AND (SELECT COUNT(*) FROM avatar_operations WHERE user_id=? AND object_key IS NOT NULL)<40
    ON CONFLICT(user_id,id) DO NOTHING`, [user, id, expected, digest, key, normalized?.length ?? 0,
    new Date().toISOString(), user, new Date(Date.now() - 24 * 3600_000).toISOString(), user]);
  const op = await queryOne<{ state: string; digest: string; expected: string; created_at: string }>(
    "SELECT state,digest,expected,created_at FROM avatar_operations WHERE user_id=? AND id=?", [user, id]);
  if (!op) throw new AvatarError("Photo limit reached (20 times per day), or old photos await cleanup. Try again tomorrow.", 429);
  if (op.digest !== digest || op.expected !== expected) throw new AvatarError("This retry does not match the original photo.", 409);
  if (op.state === "committed") return avatarState(user);
  if (op.state !== "pending" || Date.parse(op.created_at) < Date.now() - 3600_000)
    throw new AvatarError("This photo request expired. Refresh and choose the photo again.", 409);
  if ((await avatarState(user)).revision !== expected) throw new AvatarError("Your photo changed on another device. Refresh before trying again.", 409);
  if (normalized) await putObject(key!, Uint8Array.from(normalized).buffer, "image/webp", AbortSignal.timeout(30_000));
  // Atomic compare-and-swap and receipt: losing the response never loses the previous photo.
  await transaction([
    { sql: "INSERT INTO profile_avatars(user_id,revision,updated_at) VALUES(?,'',?) ON CONFLICT(user_id) DO NOTHING", params: [user, new Date().toISOString()] },
    { sql: `UPDATE profile_avatars SET revision=?,object_key=?,bytes=?,updated_at=?
      WHERE user_id=? AND revision=? AND EXISTS (
        SELECT 1 FROM avatar_operations WHERE user_id=? AND id=? AND state='pending')`,
      params: [id, key, normalized?.length ?? 0, new Date().toISOString(), user, expected, user, id] },
    { sql: `UPDATE avatar_operations SET state=CASE WHEN EXISTS (
      SELECT 1 FROM profile_avatars WHERE user_id=? AND revision=?) THEN 'committed' ELSE 'superseded' END
      WHERE user_id=? AND id=? AND state='pending'`, params: [user, id, user, id] },
  ]);
  const receipt = await queryOne<{ state: string }>("SELECT state FROM avatar_operations WHERE user_id=? AND id=?", [user, id]);
  if (receipt?.state !== "committed") throw new AvatarError("Your photo changed on another device. Refresh before trying again.", 409);
  try { await cleanupAvatars(user); } catch { console.error("Avatar cleanup deferred"); }
  return avatarState(user);
}

export async function readAvatar(user: string) {
  const state = await avatarState(user);
  return state.object_key ? getObject(state.object_key) : null;
}
