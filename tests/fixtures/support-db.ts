/** Opt-in browser fixture only. Never imported by the normal Vite config. */
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {pbkdf2Sync} from "node:crypto";
import {fileURLToPath} from "node:url";
export type Row=Record<string,unknown>;
export type Statement={sql:string;params?:unknown[]};
const global=globalThis as typeof globalThis & {supportFixtureDb?:DatabaseSync};
const fresh=!global.supportFixtureDb;
export const db=global.supportFixtureDb??=new DatabaseSync("/tmp/scous-support-browser.sqlite");
if(fresh){
  db.exec(readFileSync(fileURLToPath(new URL("../../src/db/schema.sql",import.meta.url)),"utf8"));
  const salt="000102030405060708090a0b0c0d0e0f";
  const hash=`pbkdf2$100000$${salt}$${pbkdf2Sync("Support-fixture-2026",Buffer.from(salt,"hex"),100000,32,"sha256").toString("hex")}`;
  for(const [id,role,email,name] of [
    ["11111111-1111-4111-8111-111111111111","user","member@support.invalid","Test Member"],
    ["22222222-2222-4222-8222-222222222222","admin","admin@support.invalid","Test Admin"],
    ["33333333-3333-4333-8333-333333333333","user","other@support.invalid","Other Member"],
  ]){
    db.prepare(`INSERT OR IGNORE INTO users(id,email,password_hash,email_confirmed_at,created_at,updated_at) VALUES(?,?,?,'2026-01-01','2026-01-01','2026-01-01')`).run(id,email,hash);
    db.prepare(`INSERT OR IGNORE INTO profiles(id,email,full_name,is_verified,created_at,updated_at) VALUES(?,?,?,1,'2026-01-01','2026-01-01')`).run(id,email,name);
    db.prepare(`INSERT OR IGNORE INTO user_roles VALUES(?,?,?,'2026-01-01')`).run(id+"-role",id,role);
    db.prepare(`INSERT OR IGNORE INTO wallets(id,user_id,created_at,updated_at) VALUES(?,?,'2026-01-01','2026-01-01')`).run(id+"-wallet",id);
  }
  db.exec(`INSERT OR IGNORE INTO app_settings(id,alert_emails,updated_at) VALUES(1,'["never-send@support.invalid"]','2026-01-01')`);
  console.info("[support fixture] isolated SQLite active; no D1 requests");
}
const bind=(p:unknown[])=>p.map(x=>typeof x==="boolean"?+x:x??null) as (string|number|null)[];
export async function query<T extends Row=Row>(sql:string,params:unknown[]=[]):Promise<T[]> {return db.prepare(sql).all(...bind(params)) as T[];}
export async function queryOne<T extends Row=Row>(sql:string,params:unknown[]=[]):Promise<T|null>{return (await query<T>(sql,params))[0]??null;}
export async function execute(sql:string,params:unknown[]=[]){return {changes:Number(db.prepare(sql).run(...bind(params)).changes)};}
export async function transaction(steps:Statement[]){
  db.exec("BEGIN");
  try{const rows=steps.map(s=>db.prepare(s.sql).all(...bind(s.params??[])));db.exec("COMMIT");return rows;}
  catch(e){db.exec("ROLLBACK");throw e;}
}
export const publicQuery=query;
export const nowIso=()=>new Date().toISOString();
export const newId=()=>crypto.randomUUID();
export const toNaira=(n:unknown)=>Number(n??0)/100;
export const toKobo=(n:unknown)=>Math.round(Number(n)*100);
export const literal=(n:unknown)=>typeof n==="number"?String(n):`'${String(n??"").replaceAll("'","''")}'`;
