import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {generateKeyPairSync,createHash,sign,randomBytes} from "node:crypto";
import {isoCBOR} from "@simplewebauthn/server/helpers";
const db=new DatabaseSync(":memory:");
let session={},cookies={},origin="https://scousgiftcardexchange.com";
globalThis.__pk={
  session:()=>({data:session,clear:async()=>{session={}},update:async d=>{session={...d}}}),
  cookie:k=>cookies[k],set:(k,v)=>{cookies[k]=v},origin:()=>origin,
  query:async(s,p=[])=>db.prepare(s).all(...p),
  one:async(s,p=[])=>db.prepare(s).get(...p)||null,
  exec:async(s,p=[])=>db.prepare(s).run(...p),
  tx:async steps=>{db.exec("BEGIN");try{const r=steps.map(x=>db.prepare(x.sql).all(...(x.params||[])));db.exec("COMMIT");return r}catch(e){db.exec("ROLLBACK");throw e}},
};
const mocks={
 "@tanstack/react-start/server":`const m=globalThis.__pk; export const useSession=async()=>m.session(),getCookie=m.cookie,setCookie=m.set,getRequestHeader=m.origin;`,
 db:`const m=globalThis.__pk;export const query=m.query,queryOne=m.one,execute=m.exec,transaction=m.tx,nowIso=()=>new Date().toISOString();`,
 metrics:`export const measure=()=>{};`,
};
registerHooks({resolve(s,c,next){const k=s.includes("d1.server")?"db":s.includes("observability.server")?"metrics":s;
 if(mocks[k])return {url:"data:text/javascript,"+encodeURIComponent(mocks[k]),shortCircuit:true};
 try{return next(s,c)}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e}}});
process.env.SESSION_SECRET="isolated-only-secret-not-for-live-use";
process.env.PASSKEY_ENABLED="true";
delete process.env.ADMIN_EMAIL;
const guard=await import("../src/lib/guard.server.ts");
const pk=await import("../src/lib/passkey.server.ts");
const policy=await import("../src/lib/passkey-policy.server.ts");
db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
const password=await guard.hashPassword("Fixture-password-2026");
for(const [id,role] of [["member","user"],["other","user"],["rep","admin"]]){
 db.prepare("INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,'now','now')").run(id,id+"@example.invalid",password);
 db.prepare("INSERT INTO profiles(id,email,is_verified,created_at,updated_at) VALUES(?,?,1,'now','now')").run(id,id+"@example.invalid");
 db.prepare("INSERT INTO user_roles VALUES(?,?,?,'now')").run(id+"role",id,role);
}
const hash=b=>createHash("sha256").update(b).digest();
const b64=b=>Buffer.from(b).toString("base64url");
function authenticator(){
 const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),jwk=pair.publicKey.export({format:"jwk"}),id=randomBytes(32);
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,"base64url")],[-3,Buffer.from(jwk.y,"base64url")]]));
 return {pair,id,cose};
}
function registration(a,options,flags=0x45){
 const client=Buffer.from(JSON.stringify({type:"webauthn.create",challenge:options.challenge,origin}));
 const length=Buffer.alloc(2);length.writeUInt16BE(a.id.length);
 const auth=Buffer.concat([hash("scousgiftcardexchange.com"),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),length,a.id,Buffer.from(a.cose)]);
 return {id:b64(a.id),rawId:b64(a.id),type:"public-key",clientExtensionResults:{},
  response:{clientDataJSON:b64(client),attestationObject:b64(isoCBOR.encode(new Map([["fmt","none"],["attStmt",new Map()],["authData",auth]]))),transports:["internal"]}};
}
function assertion(a,o,{flags=5,rp="scousgiftcardexchange.com",who="member"}={}){
 const client=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:o.challenge,origin}));
 const auth=Buffer.concat([hash(rp),Buffer.from([flags]),Buffer.alloc(4)]);
 return {id:b64(a.id),rawId:b64(a.id),type:"public-key",clientExtensionResults:{},
  response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(sign("sha256",Buffer.concat([auth,hash(client)]),a.pair.privateKey)),userHandle:b64(who)}};
}
async function reset(){
 db.exec("DELETE FROM passkey_sessions; DELETE FROM passkey_credentials; DELETE FROM passkey_challenges; DELETE FROM passkey_limits; DELETE FROM sessions; UPDATE profiles SET frozen_at=NULL,deleted_at=NULL,is_verified=1;");
 session={};cookies={};origin="https://scousgiftcardexchange.com";
 await guard.startSession("member","member@example.invalid");
}
async function enroll(){const a=authenticator();await pk.finishRegistration(registration(a,await pk.beginRegistration()),"Phone");return a;}
test("real signed discoverable passkey: enrollment, no-OTP login, persistent session, replay, rename and revoke",async()=>{
 await reset();const a=await enroll();await guard.endSession();
 const o=await pk.beginLogin(true),r=assertion(a,o);
 await pk.finishLogin(r);assert.equal(await guard.currentUserId(),"member");
 const s=db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(session.sessionId);
 assert.ok(Date.parse(s.expires_at)>Date.now()+29*86400000);
 await assert.rejects(pk.finishLogin(r),/expired|used/);
 await pk.manage({id:b64(a.id),action:"rename",name:"New name"});
 assert.equal((await pk.status()).credentials[0].name,"New name");
 await pk.manage({id:b64(a.id),action:"remove"});
 assert.equal(await guard.currentUserId(),null);
 assert.equal(db.prepare("SELECT count(*) n FROM otp_codes").get().n,0);
});
test("representatives, unverified, frozen and deleted members cannot enroll",async()=>{
 await reset();await guard.startSession("rep","rep@example.invalid");
 await assert.rejects(pk.beginRegistration(),/verified members/);
 await guard.startSession("member","member@example.invalid");
 for(const setting of ["is_verified=0","is_verified=1,frozen_at='now'","frozen_at=NULL,deleted_at='now'"]){
  db.exec("UPDATE profiles SET "+setting+" WHERE id='member'");
  await assert.rejects(pk.beginRegistration());
 }
});
test("wrong RP, missing user verification, wrong user handle and origin fail",async()=>{
 await reset();const a=await enroll();await guard.endSession();
 for(const opts of [{flags:1},{rp:"attacker.example"},{who:"other"}]){
  const o=await pk.beginLogin(false);await assert.rejects(pk.finishLogin(assertion(a,o,opts)));
 }
 origin="https://attacker.example";await assert.rejects(pk.beginLogin(false),/configured Scous/);
});
test("challenge binding, expiry, concurrent consume and member ownership",async()=>{
 await reset();const a=await enroll();const original={...session};
 await guard.endSession();const o=await pk.beginLogin(false),r=assertion(a,o);
 const old=cookies.scous_passkey_binding;cookies.scous_passkey_binding="a".repeat(64);
 await assert.rejects(pk.finishLogin(r));cookies.scous_passkey_binding=old;
 const results=await Promise.allSettled([pk.finishLogin(r),pk.finishLogin(r)]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 const newer=await pk.beginLogin(false);
 db.exec("UPDATE passkey_challenges SET expires_at='2000-01-01'");
 await assert.rejects(pk.finishLogin(assertion(a,newer)));
 await guard.startSession("other","other@example.invalid");
 await assert.rejects(pk.manage({id:b64(a.id),action:"remove"}),/not found/);
});
test("stale management needs proof; credential password binding invalidates recovery and frozen sessions",async()=>{
 await reset();const a=await enroll();
 db.prepare("UPDATE sessions SET created_at='2000-01-01' WHERE id=?").run(session.sessionId);
 await assert.rejects(pk.beginRegistration(),/password/);
 await pk.beginRegistration("Fixture-password-2026");
 await pk.finishLogin(assertion(a,await pk.beginLogin(false)));
 db.exec("UPDATE profiles SET frozen_at='now' WHERE id='member'");
 assert.equal(await guard.currentUserId(),null);
 db.exec("UPDATE profiles SET frozen_at=NULL WHERE id='member'; UPDATE users SET password_hash='changed' WHERE id='member'");
 await assert.rejects(pk.finishLogin(assertion(a,await pk.beginLogin(false))));
 db.prepare("UPDATE users SET password_hash=? WHERE id='member'").run(password);
});
test("isolated 10,000 atomic limiter attempts stay bounded (not network capacity)",async()=>{
 db.exec("DELETE FROM passkey_limits");
 const start=performance.now();
 const result=await Promise.allSettled(Array.from({length:10000},()=>policy.throttle("burst",20)));
 assert.equal(result.filter(r=>r.status==="fulfilled").length,20);
 assert.equal(db.prepare("SELECT count FROM passkey_limits WHERE key='burst'").get().count,20);
 console.log("10,000 local SQLite throttle attempts, ms:",Math.round(performance.now()-start),"accepted:20 rejected:9980; not production throughput");
});
