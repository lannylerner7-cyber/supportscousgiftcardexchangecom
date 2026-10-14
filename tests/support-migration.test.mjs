import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { sql, sha256, statements, runImport, createTransport } from "../scripts/support-import.mjs";

const schema = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(schema.replace(/-- SUPPORT_CHAT_START[\s\S]*?-- SUPPORT_CHAT_END/, ""));
  const events = [], records = [], logs = [], bodies = [];
  let poll = 0;
  return { db, events, records, logs, bodies, input: {
    log: text => logs.push(text), sleep: async () => {}, maxPolls: 2,
    saveRecovery: async record => {
      events.push("save");
      if (options.saveFailure) throw Error("Disk full");
      records.push(record);
    },
    upload: async (_url, body) => { events.push("upload"); assert.equal(body, sql); },
    api: async (path, body) => {
      events.push(body?.action ?? path);
      bodies.push(body);
      if (path === "/time_travel/bookmark") return { bookmark: options.noBookmark ? "" : "recovery-001" };
      if (body?.action === "init") return options.init ?? { filename: "fixture.sql", upload_url: "https://example.invalid/upload?signature=PRIVATE" };
      if (body?.action === "ingest") {
        db.exec(sql);
        if (options.missing) db.exec("DROP TRIGGER support_message_validate");
        if (options.altered) db.exec("DROP TRIGGER support_message_commit; CREATE TRIGGER support_message_commit AFTER INSERT ON chat_messages BEGIN SELECT 1; END;");
        return options.ingest ?? { at_bookmark: "running-001" };
      }
      if (body?.action === "poll") {
        assert.equal(body.current_bookmark, "running-001");
        poll++;
        return options.poll ?? (poll === 1 ? { at_bookmark: "running-001" } : {
          status: "complete", success: true,
          result: { final_bookmark: "final-001" },
          messages: ["Leftover SQL buffer warning https://example.invalid/?signature=PRIVATE"],
        });
      }
      assert.equal(path, "/query");
      assert.match(body.sql, /^(SELECT|PRAGMA)/);
      if (options.queryFailure) throw Error("Provider failed");
      return [{ success: true, results: db.prepare(body.sql).all() }];
    },
  } };
}

test("dry-run is offline, prints reviewable full SQL and has no import side effect", () => {
  const out = spawnSync(process.execPath, ["scripts/apply-support-migration.mjs", "--dry-run"], {
    cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH }, encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /no database accessed/);
  assert.ok(out.stdout.includes(sql));
  assert.ok(out.stdout.includes(sha256));
  assert.match(out.stdout, /block ALL access/);
  assert.equal(statements.length, 14);
});

test("apply fails closed without target/hash/outage/recovery approval", async () => {
  const { main } = await import("../scripts/apply-support-migration.mjs");
  const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), D1_DATABASE_ID: "a".repeat(36) };
  const flags = ["--apply", "--confirm-target", `${env.CLOUDFLARE_ACCOUNT_ID}/${env.D1_DATABASE_ID}`,
    "--confirm-sha256", sha256, "--accept-database-block", "--recovery-file", "/unused"];
  for (const remove of ["--confirm-target", "--confirm-sha256", "--accept-database-block", "--recovery-file"]) {
    const bad = [...flags], index = bad.indexOf(remove);
    bad.splice(index, remove === "--accept-database-block" ? 1 : 2);
    await assert.rejects(main(bad, env), /required/);
  }
  await assert.rejects(main(["--apply", "--dry-run"], env), /not both/);
  await assert.rejects(main(["--tables-only"], env));
  for (const flag of ["--confirm-target", "--confirm-sha256"]) {
    const bad = [...flags];
    bad[bad.indexOf(flag) + 1] = "mismatched-review";
    await assert.rejects(main(bad, env), /required/);
  }
});

test("full import saves recovery before init, polls until complete and verifies all objects", async t => {
  const f = fixture(t);
  await runImport(f.input);
  assert.deepEqual(f.events.slice(0, 5), ["/time_travel/bookmark", "save", "init", "upload", "ingest"]);
  assert.ok(f.records.some(r => r.recoveryBookmark === "recovery-001"));
  assert.ok(f.records.some(r => r.importBookmark === "running-001"));
  assert.ok(f.records.some(r => r.finalBookmark === "final-001"));
  assert.equal(f.records.at(-1).verified, true);
  assert.ok(f.bodies.filter(b => b?.action === "init" || b?.action === "ingest").every(b => /^[a-f0-9]{32}$/.test(b.etag)));
  assert.equal(f.logs.join("").includes("PRIVATE"), false);
  // Entire script is additive/idempotent; both complete trigger bodies remain installed.
  dbReapply(f.db);
});
function dbReapply(db) {
  db.exec(sql);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'support_%'").get().n, 2);
}

test("cached upload skips PUT; immediate completion still verifies", async t => {
  const f = fixture(t, { init: { filename: "cached.sql" }, ingest: { status: "complete" } });
  await runImport(f.input);
  assert.ok(!f.events.includes("upload"));
  assert.ok(!f.events.includes("poll"));
  assert.equal(f.records.at(-1).verified, true);
});

for (const [name, options, pattern] of [
  ["missing bookmark", { noBookmark: true }, /bookmark/],
  ["unsaved recovery", { saveFailure: true }, /Disk full/],
  ["init error", { init: { status: "error", error: "PRIVATE" } }, /initialization failed/],
  ["unsafe upload URL", { init: { filename: "f", upload_url: "http://example.invalid/?PRIVATE" } }, /Unsafe upload/],
  ["failed import with successful envelope", { ingest: { status: "error", success: true, error: "PRIVATE" } }, /import failure/],
  ["nested failure", { ingest: { status: "complete", success: false } }, /import failure/],
  ["unknown status", { ingest: { status: "unexpected" } }, /Unrecognized/],
  ["missing polling bookmark", { ingest: {} }, /bookmark/],
  ["timeout", { poll: { at_bookmark: "running-001" } }, /timed out/],
  ["poll failure", { poll: { status: "error" } }, /import failure/],
  ["missing authorization trigger", { missing: true }, /verification failed/],
  ["altered commit trigger", { altered: true }, /verification failed/],
  ["metadata unavailable", { queryFailure: true }, /verification failed/],
]) {
  test(name + " never claims success or falls back", async t => {
    const f = fixture(t, options);
    await assert.rejects(runImport(f.input), pattern);
    assert.ok(!f.records.some(r => r.verified));
    assert.ok(!f.logs.join("").includes("PRIVATE"));
    assert.ok(f.events.filter(e => e === "ingest").length <= 1);
    if (options.noBookmark || options.saveFailure) assert.ok(!f.events.includes("init"));
  });
}

test("transport redacts raw errors, HTTP bodies and nested provider failures", async () => {
  for (const request of [
    async () => { throw Error("https://example.invalid/?signature=PRIVATE"); },
    async () => new Response("PRIVATE", { status: 403 }),
    async () => new Response("PRIVATE"),
    async () => Response.json({ success: false, errors: [{ message: "PRIVATE" }] }),
    async () => Response.json({ success: true, errors: [{ message: "PRIVATE" }], result: {} }),
  ]) {
    const api = createTransport({ request, base: "https://example.invalid", headers: {} }).api;
    await assert.rejects(api("/import", {}), error => !error.message.includes("PRIVATE") && /redacted/.test(error.message));
  }
});

test("signed upload never forwards credentials or follows redirects; upload errors are redacted", async () => {
  const base = { request: async () => {}, base: "https://example.invalid", headers: { Authorization: "PRIVATE" } };
  await createTransport({ ...base, fetchUpload: async (url, init) => {
    assert.equal(init.headers, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.body, sql);
    return new Response();
  } }).upload("https://example.invalid/?signature=PRIVATE", sql);
  for (const fetchUpload of [async () => { throw Error("PRIVATE"); }, async () => new Response("PRIVATE", { status: 500 })])
    await assert.rejects(createTransport({ ...base, fetchUpload }).upload("https://example.invalid/?signature=PRIVATE", sql),
      error => /redacted/.test(error.message) && !error.message.includes("PRIVATE"));
});
