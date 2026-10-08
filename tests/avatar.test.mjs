import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import sharp from "sharp";
const db = new DatabaseSync(":memory:");
const objects = new Map();
let user = "member", failPut = false, loseCommit = false, failDelete = false, loseReservation = false;
globalThis.__avatarTests = {
  currentUserId: async () => user,
  execute: async (sql, p = []) => {
    const result = db.prepare(sql).run(...p);
    if (loseReservation && sql.startsWith("INSERT INTO avatar_operations")) { loseReservation = false; throw Error("Lost reservation"); }
    return result;
  },
  isAdmin: async () => true,
  queryOne: async (sql, p = []) => db.prepare(sql).get(...p) ?? null,
  query: async (sql, p = []) => db.prepare(sql).all(...p),
  transaction: async steps => {
    db.exec("BEGIN");
    try { for (const s of steps) db.prepare(s.sql).run(...s.params); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
    if (loseCommit) { loseCommit = false; throw Error("Lost receipt"); }
  },
  putObject: async (key, bytes) => { objects.set(key, bytes); if (failPut) { failPut = false; throw Error("Lost PUT"); } },
  getObject: async key => objects.has(key) ? { body: objects.get(key) } : null,
  deleteObject: async key => { if (failDelete) throw Error("Delete failed"); objects.delete(key); },
};
registerHooks({ resolve(s, c, next) {
  if (/d1\.server|r2\.server|guard\.server/.test(s)) return { shortCircuit: true,
    url: "data:text/javascript," + encodeURIComponent("export const {currentUserId,isAdmin,execute,queryOne,query,transaction,putObject,getObject,deleteObject}=globalThis.__avatarTests;") };
  if (s === "@tanstack/react-router") return { shortCircuit: true, url: "data:text/javascript,export const createFileRoute=()=>x=>x;" };
  if (s.startsWith("@/")) return { shortCircuit: true, url: new URL("../src/" + s.slice(2) + ".ts", import.meta.url).href };
  try { return next(s, c); } catch(e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
}});
const { avatarHandler } = await import("../src/routes/api/avatar.ts");
const { Route: files } = await import("../src/routes/api/files/$.ts");
const { changeAvatar, avatarState, normalizeAvatar, cleanupAvatars } = await import("../src/lib/avatar.server.ts");
const png = await sharp({ create: { width: 600, height: 600, channels: 3, background: "red" } }).png().withMetadata().toBuffer();
function request(method, id = crypto.randomUUID(), revision = "", body = png) {
  return new Request("https://example.invalid/api/avatar", { method,
    headers: { "Content-Type": "image/png", "X-Avatar-Request": "1", "X-Operation-Id": id, "X-Avatar-Revision": revision },
    ...(method === "POST" ? { body } : {}) });
}
test("private photos: normalization, idempotency, replacement, removal, failures and authorization", async () => {
  const normalized = await normalizeAvatar(png, "image/png");
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 512); assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined);
  for (const [bytes, type] of [[png, "image/jpeg"], [png, "image/svg+xml"], [new Uint8Array(5 * 1024 * 1024 + 1), "image/png"], [new Uint8Array([1]), "image/png"]])
    await assert.rejects(normalizeAvatar(bytes, type));
  const huge = await sharp({ create: { width: 9000, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(normalizeAvatar(huge, "image/png"));
  const first = crypto.randomUUID();
  assert.equal((await avatarHandler(request("POST", first))).status, 200);
  assert.equal((await avatarHandler(request("POST", first))).status, 200);
  assert.equal(objects.size, 1);
  const original = await avatarState(user);
  const response = await avatarHandler(request("GET"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  user = "other";
  assert.equal((await avatarHandler(new Request("https://example.invalid/api/avatar?user=member"))).status, 404);
  assert.equal((await files.server.handlers.GET({ params: { _splat: original.object_key } })).status, 404, "even admins cannot bypass the avatar endpoint");
  user = null; assert.equal((await avatarHandler(request("GET"))).status, 401);
  user = "member";
  assert.equal((await avatarHandler(new Request("https://example.invalid/api/avatar", { method: "POST", body: png }))).status, 403);
  const second = crypto.randomUUID();
  loseReservation = true;
  assert.equal((await avatarHandler(request("POST", second, first))).status, 503);
  assert.deepEqual(await avatarState(user), original);
  assert.equal(objects.size, 1);
  failPut = true;
  assert.equal((await avatarHandler(request("POST", second, first))).status, 503);
  assert.deepEqual(await avatarState(user), original);
  loseCommit = true;
  assert.equal((await avatarHandler(request("POST", second, first))).status, 503);
  assert.equal((await avatarState(user)).revision, second);
  assert.equal((await avatarHandler(request("POST", second, first))).status, 200);
  assert.equal((await avatarHandler(request("POST", crypto.randomUUID(), first))).status, 409);
  assert.equal(objects.size, 2);
  const removal = crypto.randomUUID();
  loseCommit = true;
  assert.equal((await avatarHandler(request("DELETE", removal, second))).status, 503);
  assert.equal((await avatarHandler(request("DELETE", removal, second))).status, 200);
  assert.equal((await avatarState(user)).object_key, null);
  assert.equal((await avatarHandler(request("POST", second, first))).status, 200);
  assert.equal((await avatarState(user)).object_key, null, "old retries cannot restore removed photo");
  const third = crypto.randomUUID();
  await changeAvatar(user, third, removal, png, "image/png");
  db.exec("UPDATE avatar_operations SET created_at='2020-01-01'");
  failDelete = true; await assert.rejects(cleanupAvatars(user));
  assert.equal(objects.size, 3);
  failDelete = false; await cleanupAvatars(user);
  assert.equal(objects.size, 1, "only the current photo survives cleanup");
  assert.equal((await avatarHandler(request("GET"))).status, 200);
  const key = (await avatarState(user)).object_key;
  assert.ok(objects.has(key));
  const orphan = crypto.randomUUID();
  failPut = true;
  await assert.rejects(changeAvatar(user, orphan, third, png, "image/png"));
  db.prepare("UPDATE avatar_operations SET created_at='2020-01-01' WHERE id=?").run(orphan);
  await cleanupAvatars(user);
  assert.equal(objects.size, 1, "confirmed expired orphan is removed");
  await assert.rejects(changeAvatar(user, orphan, third, png, "image/png"), /expired/);
  assert.ok(objects.has(key), "current photo is retained regardless of age");
});
test("atomic quotas and concurrent competing replacements", async () => {
  user = "quota";
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const results = await Promise.allSettled([changeAvatar(user, a, "", png, "image/png"), changeAvatar(user, b, "", png, "image/png")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (let n = 0; n < 18; n++) {
    const state = await avatarState(user);
    await changeAvatar(user, crypto.randomUUID(), state.revision, null, "");
  }
  const state = await avatarState(user);
  await assert.rejects(changeAvatar(user, crypto.randomUUID(), state.revision, null, ""), /20 times/);
});
