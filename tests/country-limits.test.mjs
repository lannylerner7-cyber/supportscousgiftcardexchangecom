import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
let allowed = true;
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE gift_card_variants (
 id TEXT PRIMARY KEY, brand_id TEXT, region_id TEXT, min_value INTEGER,
 max_value INTEGER, rate_naira INTEGER, updated_at TEXT);
 CREATE TABLE admin_audit_log (
 id TEXT, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, after TEXT, created_at TEXT);`);
globalThis.__countryTest = {
  admin: async () => { if (!allowed) throw new Error("Admin access required"); return "admin"; },
  query: async (s, p) => db.prepare(s).all(...p),
  execute: async (s, p) => db.prepare(s).run(...p),
};
const mocks = {
  "@tanstack/react-start": `export function createServerFn(){let validate;return {inputValidator(v){validate=v;return this},handler(f){return async x=>f({data:validate(x.data)})}}}`,
  guard: `export const requireAdminId=globalThis.__countryTest.admin;`,
  db: `export const query=globalThis.__countryTest.query, execute=globalThis.__countryTest.execute;
    export const toKobo=n=>Math.round(n*100), nowIso=()=>new Date().toISOString(),newId=()=>crypto.randomUUID();`,
};
registerHooks({resolve(s,c,next){
  const key=s.includes("guard.server")?"guard":s.includes("d1.server")?"db":s;
  if(mocks[key])return {url:"data:text/javascript,"+encodeURIComponent(mocks[key]),shortCircuit:true};
  try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}
}});
const {adminSetCountryLimits} = await import("../src/lib/admin.people.functions.ts");
function setup() {
  allowed=true;db.exec("DELETE FROM gift_card_variants; DELETE FROM admin_audit_log;");
  for(const [id,brand,country] of [
    ["usa-physical","apple-brand-id","usa"],["usa-ecode","apple-brand-id","usa"],
    ["uk-physical","apple-brand-id","uk"],["other-usa","other-brand-id","usa"],
  ])db.prepare("INSERT INTO gift_card_variants VALUES(?,?,?,2500,500000,120000,'before')").run(id,brand,country);
}
const update = data => adminSetCountryLimits({data:{brandId:"apple-brand-id",regionId:"usa",min:10,max:500,...data}});
test("Apple USA limits update both types without touching UK, another brand or rates",async()=>{
  setup();await update({});
  for(const id of ["usa-physical","usa-ecode"]){
    const row=db.prepare("SELECT * FROM gift_card_variants WHERE id=?").get(id);
    assert.equal(row.min_value,1000);assert.equal(row.max_value,50000);assert.equal(row.rate_naira,120000);
  }
  for(const id of ["uk-physical","other-usa"]){
    const row=db.prepare("SELECT * FROM gift_card_variants WHERE id=?").get(id);
    assert.equal(row.min_value,2500);assert.equal(row.max_value,500000);assert.equal(row.updated_at,"before");
  }
  assert.equal(db.prepare("SELECT count(*) n FROM admin_audit_log").get().n,1);
  await update({min:25,max:5000});
  assert.equal(db.prepare("SELECT max_value FROM gift_card_variants WHERE id='usa-ecode'").get().max_value,500000);
});
test("invalid ranges, missing country and non-admin updates are rejected",async()=>{
  setup();
  for(const range of [{min:0},{min:501,max:500},{max:5001},{min:10.5},{min:NaN}]){
    await assert.rejects(update(range));
  }
  await assert.rejects(update({regionId:"missing"}),/No gift-card variants/);
  allowed=false;await assert.rejects(update({}),/Admin access required/);
  assert.equal(db.prepare("SELECT count(*) n FROM gift_card_variants WHERE min_value=2500").get().n,4);
});
test("trade eligibility uses the selected variant's limits and member screens refresh",()=>{
  const source=readFileSync(new URL("../src/lib/trade.functions.ts",import.meta.url),"utf8");
  assert.match(source,/WHERE v\.id = \? AND v\.is_active = 1/);
  assert.match(source,/faceUnits < min/);assert.match(source,/faceUnits > max/);
  const member=readFileSync(new URL("../src/routes/_authenticated/app.trade.tsx",import.meta.url),"utf8");
  assert.match(member,/useMarketRealtime\(\)/);
  assert.match(member,/v\.region_id === regionId/);
  assert.match(member,/value >= Number\(variant.min_value\)/);
});
test("admin shell subscribes to live support summary and overview uses the same count",()=>{
  const shell=readFileSync(new URL("../src/routes/_authenticated/ScousGiftCardExchange.admin.tsx",import.meta.url),"utf8");
  const overview=readFileSync(new URL("../src/routes/_authenticated/ScousGiftCardExchange.admin.index.tsx",import.meta.url),"utf8");
  assert.match(shell,/useSupportSummary\(\)/);assert.match(shell,/unread support messages/);
  assert.match(overview,/SUPPORT_SUMMARY_KEY/);assert.match(overview,/support.data\?\.unread/);
});
