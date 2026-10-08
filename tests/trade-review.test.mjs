import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Run the real handler/SQL against isolated SQLite, with network and auth stubbed.
// No live database or mail calls are made by these tests.
let db;
globalThis.__scousReviewTest = {
  queryOne: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
  transaction: async (statements) => {
    db.exec("BEGIN");
    try {
      const rows = statements.map(s => db.prepare(s.sql).all(...(s.params ?? [])));
      db.exec("COMMIT");
      return rows;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  },
};
const modules = {
  "@tanstack/react-start": `export function createServerFn() {
    let validate = x => x;
    return {inputValidator(fn){validate=fn;return this},handler(fn){return x=>fn({data:validate(x?.data)})}};
  }`,
  "./guard.server": `export const requireAdminId = async () => 'admin';`,
  "./d1.server": `export const {queryOne,transaction}=globalThis.__scousReviewTest;
    export const toKobo=n=>Math.round(Number(n)*100);
    export const newId=()=>crypto.randomUUID();
    export const nowIso=()=>new Date().toISOString();`,
  "./member-mail.server": `export const mailMember=async()=>{};export const naira=String;`,
  "./email.server": `export const cardCreditedEmail=()=>({});`,
};
registerHooks({
  resolve(s,c,next) {
    if (modules[s]) return {url:`data:text/javascript,${encodeURIComponent(modules[s])}`,shortCircuit:true};
    try { return next(s,c); } catch(e) {
      if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);
      throw e;
    }
  },
});
const {adminReviewTrade} = await import("../src/lib/admin.functions.ts");
function setup() {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  for(const id of ["admin","member","inviter"]) {
    db.prepare("INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,'now','now')").run(id,`${id}@example.invalid`,"fixture");
    db.prepare("INSERT INTO profiles(id,email,created_at,updated_at) VALUES(?,?,'now','now')").run(id,`${id}@example.invalid`);
    db.prepare("INSERT INTO wallets(id,user_id,balance_naira,locked_naira,created_at,updated_at) VALUES(?,?,500000,500000,'now','now')").run(id,id);
  }
  db.exec(`UPDATE profiles SET referred_by='inviter' WHERE id='member';
    INSERT INTO trades(id,user_id,brand_name,region_code,card_type,face_value,rate_at_submit,expected_payout,created_at,updated_at)
    VALUES('test-trade-1','member','Test card','US','physical',10000,10000,1000000,'now','now');`);
}
const balance=()=>db.prepare("SELECT balance_naira,locked_naira FROM wallets WHERE id='member'").get();
test("successful review releases welcome bonus but never pays inviter at redemption",async()=>{
  setup();
  await adminReviewTrade({data:{tradeId:"test-trade-1",status:"successful"}});
  assert.equal(balance().balance_naira,1500000);
  assert.equal(balance().locked_naira,0);
  assert.equal(db.prepare("SELECT balance_naira FROM wallets WHERE id='inviter'").get().balance_naira,500000);
  await assert.rejects(adminReviewTrade({data:{tradeId:"test-trade-1",status:"successful"}}),/already reviewed/);
  assert.equal(balance().balance_naira,1500000);
  db.close();
});
test("partial payment leaves welcome bonus locked",async()=>{
  setup();
  await adminReviewTrade({data:{tradeId:"test-trade-1",status:"partially_paid",paid:1000}});
  assert.equal(balance().balance_naira,600000);
  assert.equal(balance().locked_naira,500000);
  db.close();
});
test("concurrent reviews credit, notify and audit once",async()=>{
  setup();
  const results=await Promise.allSettled([
    adminReviewTrade({data:{tradeId:"test-trade-1",status:"successful"}}),
    adminReviewTrade({data:{tradeId:"test-trade-1",status:"successful"}}),
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(balance().balance_naira,1500000);
  for(const table of ["wallet_transactions","notifications","admin_audit_log"])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
  db.close();
});
test("declined card neither credits nor unlocks",async()=>{
  setup();
  await adminReviewTrade({data:{tradeId:"test-trade-1",status:"error"}});
  assert.equal(balance().balance_naira,500000);
  assert.equal(balance().locked_naira,500000);
  db.close();
});
test("ledger failure rolls back payout, unlock and review status",async()=>{
  setup();
  db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON wallet_transactions BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(adminReviewTrade({data:{tradeId:"test-trade-1",status:"successful"}}),/fixture failure/);
  assert.equal(balance().balance_naira,500000);
  assert.equal(balance().locked_naira,500000);
  assert.equal(db.prepare("SELECT status FROM trades").get().status,"pending");
  db.close();
});
