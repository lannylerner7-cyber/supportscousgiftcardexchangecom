import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expectedSchema, checkSchemaReadiness } from "./schema-readiness.mjs";

const source = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const parts = source.split("-- SUPPORT_CHAT_START");
if (parts.length !== 2 || parts[1].split("-- SUPPORT_CHAT_END").length !== 2)
  throw Error("Support migration markers missing or duplicated.");
export const sql = parts[1].split("-- SUPPORT_CHAT_END")[0].trim() + "\n";
// Exported for local regression tests only; NEVER submit these to D1 query/batch.
export const statements = [...sql.matchAll(/^CREATE TRIGGER[\s\S]*?^END;|^(?:CREATE (?:TABLE|INDEX)|INSERT INTO)[\s\S]*?;/gm)].map(m => ({ sql: m[0] }));
if (statements.length !== 14 || statements.filter(s => s.sql.startsWith("CREATE TRIGGER")).length !== 2)
  throw Error("Support migration changed; review its full SQL and manifest before importing.");
export const sha256 = createHash("sha256").update(sql).digest("hex");
const etag = createHash("md5").update(sql).digest("hex");
const schema = expectedSchema();
export const manifest = {
  tables: schema.tables.filter(t => t.name.startsWith("support_")),
  catalog: schema.catalog.filter(o => o.name.startsWith("support_")),
};

export const warning = "WARNING: SQL-file imports temporarily block ALL access to this D1 database, not just support chat.";
const bookmark = value => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(value))
    throw Error("Provider returned no usable bookmark.");
  return value;
};

// Provider bodies/errors are intentionally never logged: they can contain signed URLs.
export async function runImport({ api, upload, saveRecovery, log = console.log,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 120 }) {
  log(warning);
  const recovery = bookmark((await api("/time_travel/bookmark")).bookmark);
  await saveRecovery({ recoveryBookmark: recovery, sha256, capturedAt: new Date().toISOString() });
  log("Recovery bookmark saved before import initialization.");
  const init = await api("/import", { action: "init", etag });
  if (init.status === "error" || init.success === false || typeof init.filename !== "string" || !init.filename)
    throw Error("Import initialization failed.");
  // Cloudflare can reuse an already uploaded file (filename without upload_url).
  if (init.upload_url !== undefined) {
    let url;
    try { url = new URL(init.upload_url); } catch { throw Error("Invalid upload URL (redacted)."); }
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("Unsafe upload URL (redacted).");
    await upload(url.href, sql);
  }
  let result = await api("/import", { action: "ingest", etag, filename: init.filename });
  for (let polls = 0; ; polls++) {
    if (result.status === "error" || result.success === false)
      throw Error("Cloudflare reported import failure; inspect status privately before any retry.");
    if (result.status === "complete") break;
    // An absent status with at_bookmark is Cloudflare's documented in-progress response.
    if (result.status !== undefined)
      throw Error("Unrecognized import status; do not re-import.");
    const current = bookmark(result.at_bookmark);
    await saveRecovery({ importBookmark: current });
    if (polls >= maxPolls)
      throw Error("Import polling timed out; import may still be running. Do not re-import.");
    await sleep(1000);
    result = await api("/import", { action: "poll", current_bookmark: current });
  }
  if (result.result?.final_bookmark)
    await saveRecovery({ finalBookmark: bookmark(result.result.final_bookmark) });
  // Messages can include harmless leftover-buffer warnings. Completion plus schema
  // verification determines success, not message text or envelope success alone.
  log("Cloudflare reports complete; verifying tables, indexes and full trigger definitions.");
  const checked = await checkSchemaReadiness(async query => {
    const rows = await api("/query", { sql: query, params: [] });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].success !== true || !Array.isArray(rows[0].results))
      throw Error("Invalid metadata response.");
    return rows[0].results;
  }, manifest);
  if (checked.status !== "ready")
    throw Error(`Post-import verification failed (${checked.status}); do not release or install tables only.`);
  await saveRecovery({ verified: true });
  log("Support migration complete and verified, including authorization and message-commit triggers.");
}

export function createTransport({ request, fetchUpload = fetch, base, headers }) {
  return {
    async api(path, body) {
      try {
        const response = await request(base + path, {
          method: body ? "POST" : "GET", headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (data.success !== true || data.errors?.length || data.result == null) throw Error();
        return data.result;
      } catch {
        throw Error("Cloudflare request failed (details redacted); inspect status before retrying an import.");
      }
    },
    async upload(url, body) {
      try {
        // Signed R2 URL authorizes this request; NEVER forward API credentials.
        const response = await fetchUpload(url, { method: "PUT", body, redirect: "error", signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw Error();
      } catch { throw Error("SQL upload failed (signed URL and provider details redacted)."); }
    },
  };
}
