import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationStatements } from "../src/lib/verification-statements.ts";

const now = "2026-10-08T12:00:00.000Z";
function setup({referrer = "inviter", verified = 0, consumed = null, expires = "2026-10-09", attempts = 0} = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  for (const id of ["inviter", "member"]) {
    db.prepare("INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(id, `${id}@example.test`, "test-only", now, now);
    db.prepare("INSERT INTO profiles(id,email,is_verified,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(id, `${id}@example.test`, id === "member" ? verified : 1, now, now);
    db.prepare("INSERT INTO wallets(id,user_id,balance_naira,locked_naira,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(id, id, 500000, 500000, now, now);
  }
  db.prepare("UPDATE profiles SET referred_by=? WHERE id='member'").run(referrer);
  db.prepare("INSERT INTO otp_codes(id,email,purpose,code_hash,expires_at,attempts,consumed_at,created_at) VALUES('otp','member@example.test','signup','hash',?,?,?,?)")
    .run(expires, attempts, consumed, now);
  return db;
}
function verify(db, signup = true) {
  const statements = verificationStatements({email:"member@example.test",otpId:"otp",now,
    maxAttempts:3,rewardId:crypto.randomUUID(),notificationId:crypto.randomUUID(),signup});
  db.exec("BEGIN");
  try {
    const rows = statements.map(s => db.prepare(s.sql).all(...s.params));
    db.exec("COMMIT");
    return rows.at(-1).length;
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
function wallet(db, id) {
  return db.prepare("SELECT balance_naira,locked_naira FROM wallets WHERE user_id=?").get(id);
}
test("verified signup credits only inviter; new member bonus remains locked; retry pays nothing", () => {
  const db = setup();
  assert.equal(verify(db), 1);
  assert.equal(wallet(db,"inviter").balance_naira,700000);
  assert.equal(wallet(db,"inviter").locked_naira,500000);
  assert.equal(wallet(db,"member").balance_naira,500000);
  assert.equal(wallet(db,"member").locked_naira,500000);
  assert.equal(verify(db),0);
  assert.equal(wallet(db,"inviter").balance_naira,700000);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE reference_type='referral'").get().n,1);
  assert.equal(db.prepare("SELECT amount FROM wallet_transactions WHERE reference_type='referral_unlock'").get().amount,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notifications").get().n,1);
  db.close();
});
for (const [name, options] of Object.entries({
  "no referral":{referrer:null}, "self referral":{referrer:"member"},
  "already verified/no-mail bypass":{verified:1},
  "expired":{expires:"2026-10-07"}, "attempts exhausted":{attempts:3},
  "already consumed":{consumed:now},
})) test(`${name} cannot pay an inviter`, () => {
  const db=setup(options); verify(db);
  assert.equal(wallet(db,"inviter").balance_naira,500000);
  assert.equal(wallet(db,"member").balance_naira,500000);
  db.close();
});
for (const type of ["referral", "referral_unlock"]) test(`legacy ${type} prevents another payment`,()=>{
  const db=setup();
  db.prepare(`INSERT INTO wallet_transactions
    (id,wallet_id,user_id,type,amount,balance_after,reference_type,reference_id,created_at)
    VALUES('legacy','inviter','inviter','credit',200000,500000,?,'member',?)`).run(type,now);
  verify(db);
  assert.equal(wallet(db,"inviter").balance_naira,500000);
  db.close();
});
test("login OTP does not award a signup reward",()=>{
  const db=setup(); verify(db,false);
  assert.equal(wallet(db,"inviter").balance_naira,500000);
  db.close();
});
test("failed credit rolls verification, ledger and OTP back together",()=>{
  const db=setup();
  db.exec("CREATE TRIGGER reject_credit BEFORE UPDATE ON wallets BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>verify(db),/test failure/);
  assert.equal(db.prepare("SELECT consumed_at FROM otp_codes").get().consumed_at,null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM wallet_transactions").get().n,0);
  assert.equal(db.prepare("SELECT is_verified FROM profiles WHERE id='member'").get().is_verified,0);
  db.close();
});
