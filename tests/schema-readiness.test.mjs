import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { checkSchemaReadiness, expectedSchema } from "../scripts/schema-readiness.mjs";

const expected = expectedSchema();
function fixture(full = true) {
  const db = new DatabaseSync(":memory:");
  if (full) {
    const source = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    for (const [sql] of source.matchAll(/^CREATE TRIGGER[\s\S]*?^END;|^CREATE (?:TABLE|(?:UNIQUE )?INDEX)[\s\S]*?;/gm)) db.exec(sql);
  }
  const queries = [];
  const query = async sql => {
    queries.push(sql);
    assert.match(sql, /^(SELECT type,name,tbl_name,sql FROM sqlite_master|PRAGMA (table_info|foreign_key_list|index_list|index_info)\()/);
    return db.prepare(sql).all();
  };
  return { db, query, queries };
}
test("complete schema is ready; metadata only and zero writes", async () => {
  const { db, query } = fixture();
  try {
    db.exec("PRAGMA query_only=ON");
    const before = db.prepare("SELECT total_changes() n").get().n;
    assert.deepEqual(await checkSchemaReadiness(query), { status: "ready", issues: [] });
    assert.equal(db.prepare("SELECT total_changes() n").get().n, before);
  } finally { db.close(); }
});
test("empty schema lists missing login/support tables and migration sources", async () => {
  const { db, query } = fixture(false);
  try {
    const result = await checkSchemaReadiness(query);
    assert.equal(result.status, "not_ready");
    assert.equal(result.issues.filter(i => i.kind === "missing_table").length, expected.tables.length);
    assert.equal(result.issues.find(i => i.object === "session_security").migration, "src/db/remember-devices.sql");
    assert.match(result.issues.find(i => i.object === "support_message_commit").migration, /SUPPORT_CHAT_START/);
  } finally { db.close(); }
});
test("partial migration catches missing columns, index, trigger and remembered-device handles", async () => {
  const { db, query } = fixture();
  try {
    db.exec(`DROP TRIGGER support_message_commit; DROP INDEX support_mail_due;
      ALTER TABLE session_security DROP COLUMN challenge_id;
      DROP TABLE trusted_device_handles;`);
    const result = await checkSchemaReadiness(query);
    for (const [kind, object] of [
      ["missing_trigger", "support_message_commit"], ["missing_index", "support_mail_due"],
      ["missing_column", "session_security.challenge_id"], ["missing_table", "trusted_device_handles"],
    ]) assert.ok(result.issues.some(i => i.kind === kind && i.object === object));
    assert.equal(result.status, "not_ready");
  } finally { db.close(); }
});
test("same-name wrong index and no-op trigger do not pass", async () => {
  const { db, query } = fixture();
  try {
    db.exec(`DROP INDEX support_order_thread; CREATE INDEX support_order_thread ON support_order(seq);
      DROP TRIGGER support_message_commit;
      CREATE TRIGGER support_message_commit AFTER INSERT ON chat_messages BEGIN SELECT 1; END;`);
    const result = await checkSchemaReadiness(query);
    assert.ok(result.issues.some(i => i.kind === "index_definition_mismatch"));
    assert.ok(result.issues.some(i => i.kind === "trigger_definition_mismatch"));
  } finally { db.close(); }
});
test("partial table definitions and missing uniqueness fail closed", async () => {
  const { db, query } = fixture();
  try {
    db.exec(`DROP TABLE trusted_device_handles;
      CREATE TABLE trusted_device_handles(id TEXT, token_hash TEXT);`);
    const result = await checkSchemaReadiness(query);
    for (const kind of ["column_definition_mismatch", "missing_unique_constraint", "foreign_key_mismatch"])
      assert.ok(result.issues.some(i => i.kind === kind));
  } finally { db.close(); }
});
test("provider failures are redacted, never reported as ready", async () => {
  const result = await checkSchemaReadiness(async () => { throw Error("secret-token member@example.test private SQL"); });
  assert.equal(result.status, "check_failed");
  assert.doesNotMatch(JSON.stringify(result), /secret-token|member@|private SQL/);
});
test("default/help and invalid flags do not import the database transport", () => {
  for (const args of [[], ["--help"], ["--apply"]]) {
    const result = spawnSync(process.execPath, ["scripts/check-schema-readiness.mjs", ...args], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, args[0] === "--apply" ? 2 : 0);
    assert.doesNotMatch(result.stdout + result.stderr, /Database request|not configured/);
  }
});
test("liveness stays independent and request server never imports release tooling", () => {
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.ok(server.indexOf('url.pathname === "/api/public/live"') < server.indexOf("startDelivery(url.origin)"));
  assert.doesNotMatch(server, /schema-readiness|schema:check|remember-devices\.sql/);
});
