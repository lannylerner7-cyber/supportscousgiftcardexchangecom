import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
let db, session={}, cookies={}, config, sends=[], configured=true;
const password="Isolated-fixture-password-2026";
globalThis.__remember={
  session:c=>({data:session,update:async v=>{config=c;Object.assign(session,v);},clear:async()=>{session={};}}),
  getCookie:n=>cookies[n],
  setCookie:(n,v,o)=>{assert.equal(o.httpOnly,true);assert.equal(o.secure,true);if(o.maxAge===0)delete cookies[n];else cookies[n]=v;},
  query:async(s,p=[])=>db.prepare(s).all(...p),
  queryOne:async(s,p=[])=>db.prepare(s).get(...p)??null,
  execute:async(s,p=[])=>db.prepare(s).run(...p),
  transaction:async steps=>{
    db.exec("BEGIN");try{const result=steps.map(s=>db.prepare(s.sql).all(...(s.params??[])));db.exec("COMMIT");return result;}
    catch(e){db.exec("ROLLBACK");throw e;}
  },
  mail:async input=>{sends.push(input);return {sent:configured};},
  configured:()=>configured,
};
const modules={
  "@tanstack/react-start":`export function createServerFn(){let v;return{inputValidator(f){v=f;return this},handler(f){return x=>f({data:v?v(x?.data):undefined})}}}`,
  "@tanstack/react-start/server":`export const useSession=async c=>globalThis.__remember.session(c);export const getCookie=globalThis.__remember.getCookie;export const setCookie=globalThis.__remember.setCookie;`,
  d1:`export const {query,queryOne,execute,transaction}=globalThis.__remember;export const nowIso=()=>new Date().toISOString();export const newId=()=>crypto.randomUUID();`,
  email:`export const sendEmail=globalThis.__remember.mail;export const emailConfigured=globalThis.__remember.configured;export const otpEmail=(code)=>({subject:"OTP",html:code,text:code});export const welcomeEmail=()=>({});export const signupBonusEmail=()=>({});`,
  avatar:`export const avatarState=async()=>({revision:"",object_key:null});`,
};
registerHooks({resolve(s,c,next){
  const key=s.includes("d1.server")?"d1":s.includes("email.server")?"email":s.includes("avatar.server")?"avatar":s;
  if(modules[key])return {url:"data:text/javascript,"+encodeURIComponent(modules[key]),shortCircuit:true};
  try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}
}});
process.env.SESSION_SECRET="isolated-test-secret-with-sufficient-length-only";
delete process.env.ADMIN_EMAIL;
const guard=await import("../src/lib/guard.server.ts");
const {signIn,signOut,changePassword,getAccount}=await import("../src/lib/account.functions.ts");
const {requestOtp,verifyOtpCode,resetPasswordWithCode}=await import("../src/lib/auth.functions.ts");
const {registerAccount}=await import("../src/lib/signup.functions.ts");
async function setup(){
  db?.close();db=new DatabaseSync(":memory:");session={};cookies={};sends=[];configured=true;
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  const hash=await guard.hashPassword(password);
  for(const id of ["member","other","admin"]){
    db.prepare("INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,?,'now','now')").run(id,id+"@example.invalid",hash);
    db.prepare("INSERT INTO profiles(id,email,is_verified,created_at,updated_at) VALUES(?,?,1,'now','now')").run(id,id+"@example.invalid");
    db.prepare("INSERT INTO user_roles VALUES(?,?,?,'now')").run(id+"-role",id,id==="admin"?"admin":"user");
  }
}
const login=(remember=true,email="member@example.invalid")=>signIn({data:{email,password,remember}});
async function enroll(){
  assert.equal((await login()).requiresOtp,true);
  assert.equal(await guard.currentUserId(),null);
  await requestOtp({data:{email:"member@example.invalid",purpose:"login"}});
  const code=sends.at(-1).text;
  assert.equal((await verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code}})).ok,true);
  return code;
}
test("enrollment needs OTP; protected APIs deny pending and legacy sessions; trust stores only a hash",async()=>{
  await setup();await login();
  assert.equal(cookies.scous_device,undefined);
  assert.equal((await getAccount()).user,null);
  await assert.rejects(()=>guard.requireUserId(),/log in/);
  await assert.rejects(()=>verifyOtpCode({data:{email:"other@example.invalid",purpose:"login",code:"123456"}}),/start again/);
  await enroll();
  assert.equal(await guard.currentUserId(),"member");
  assert.ok(config.cookie.expires instanceof Date);
  assert.equal(cookies.scous_device.length,64);
  const row=db.prepare("SELECT * FROM trusted_devices").get();
  assert.notEqual(row.token_hash,cookies.scous_device);
  assert.equal(row.token_hash,await guard.sha256Hex(cookies.scous_device));
  const old={...session};
  db.prepare("DELETE FROM session_security WHERE session_id=?").run(old.sessionId);
  assert.equal(await guard.currentUserId(),null);
});
test("trusted password login skips email and does not extend device expiry",async()=>{
  await setup();await enroll();const expiry=db.prepare("SELECT expires_at FROM trusted_devices").get().expires_at;
  const sent=sends.length;session={}; // Browser restart retains only persistent credentials.
  assert.equal((await login()).requiresOtp,false);
  assert.equal(sends.length,sent);
  assert.equal(await guard.currentUserId(),"member");
  assert.equal(db.prepare("SELECT expires_at FROM trusted_devices").get().expires_at,expiry);
  assert.equal(db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(session.sessionId).expires_at,expiry);
  await assert.rejects(()=>requestOtp({data:{email:"member@example.invalid",purpose:"login"}}),/start again/);
  const result=await signIn({data:{email:"member@example.invalid",password:"wrong",remember:true}});
  assert.equal(result.ok,false);
});
test("unchecked login revokes this device; verified unchecked session is browser-only and at most 24 hours",async()=>{
  await setup();await enroll();session={};
  assert.equal((await login(false)).requiresOtp,true);
  assert.equal(cookies.scous_device,undefined);
  assert.equal(db.prepare("SELECT count(*) n FROM trusted_devices").get().n,0);
  db.prepare("DELETE FROM otp_codes").run();
  await requestOtp({data:{email:"member@example.invalid",purpose:"login"}});
  await verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code:sends.at(-1).text}});
  assert.equal(config.cookie.expires,undefined);
  assert.equal(config.cookie.maxAge,undefined);
  const expiry=Date.parse(db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(session.sessionId).expires_at);
  assert.ok(expiry>Date.now()+86300_000 && expiry<=Date.now()+86400_000);
});
for(const mode of ["tampered","expired","other-account"])test(`${mode} trust cannot bypass OTP`,async()=>{
  await setup();await enroll();session={};
  if(mode==="tampered")cookies.scous_device="a".repeat(64);
  if(mode==="expired")db.prepare("UPDATE trusted_devices SET expires_at='2000-01-01'").run();
  assert.equal((await login(true,mode==="other-account"?"other@example.invalid":"member@example.invalid")).requiresOtp,true);
  assert.equal(await guard.currentUserId(),null);
});
test("logout revokes trust, and replaying its saved cookie cannot bypass OTP",async()=>{
  await setup();await enroll();const token=cookies.scous_device;
  await signOut();assert.equal(await guard.currentUserId(),null);assert.equal(cookies.scous_device,undefined);
  cookies.scous_device=token;assert.equal((await login()).requiresOtp,true);
});
test("password change revokes every session and device",async()=>{
  await setup();await enroll();const old={...session},token=cookies.scous_device;
  assert.equal((await changePassword({data:{currentPassword:password,newPassword:password+"new"}})).ok,true);
  assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM trusted_devices").get().n,0);
  session=old;assert.equal(await guard.currentUserId(),null);cookies.scous_device=token;
  assert.equal((await signIn({data:{email:"member@example.invalid",password:password+"new",remember:true}})).requiresOtp,true);
});
test("password reset is single-use, removes old devices and sessions and preserves reset access",async()=>{
  await setup();await enroll();const old={...session};
  db.prepare("INSERT INTO otp_codes(id,email,purpose,code_hash,expires_at,created_at) VALUES('reset',?,'reset',?,?,'now')")
    .run("member@example.invalid",await guard.sha256Hex("member@example.invalid:123456"),new Date(Date.now()+60000).toISOString());
  const data={email:"member@example.invalid",code:"123456",password:password+"reset"};
  assert.equal((await resetPasswordWithCode({data})).ok,true);
  assert.equal(await guard.currentUserId(),"member");
  assert.equal(db.prepare("SELECT count(*) n FROM trusted_devices").get().n,0);
  assert.equal((await resetPasswordWithCode({data})).ok,false);
  session=old;assert.equal(await guard.currentUserId(),null);
});
test("SMTP failure never verifies a session; OTP is bound to its pending login and single-use",async()=>{
  await setup();configured=false;await login();
  const result=await requestOtp({data:{email:"member@example.invalid",purpose:"login"}});
  assert.equal(result.delivered,false);assert.equal(await guard.currentUserId(),null);
  const code=sends.at(-1).text;await login();
  assert.equal((await verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code}})).ok,false);
});
test("expired pending sessions and expired or invalid OTPs cannot enroll a device",async()=>{
  await setup();await login();
  await requestOtp({data:{email:"member@example.invalid",purpose:"login"}});
  const code=sends.at(-1).text;
  const wrong=code==="000000"?"999999":"000000";
  assert.equal((await verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code:wrong}})).ok,false);
  assert.equal(cookies.scous_device,undefined);
  db.prepare("UPDATE otp_codes SET expires_at='2000-01-01'").run();
  assert.equal((await verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code}})).error,"expired");
  db.prepare("UPDATE sessions SET expires_at='2000-01-01'").run();
  await assert.rejects(()=>verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code}}),/start again/);
  assert.equal(await guard.currentUserId(),null);
  assert.equal(db.prepare("SELECT count(*) n FROM trusted_devices").get().n,0);
});
test("completed OTP cannot be replayed to create another device",async()=>{
  await setup();const code=await enroll();
  await assert.rejects(()=>verifyOtpCode({data:{email:"member@example.invalid",purpose:"login",code}}),/start again/);
  assert.equal(db.prepare("SELECT count(*) n FROM trusted_devices").get().n,1);
});
test("member cannot choose admin bypass; existing admin policy remains server-owned",async()=>{
  await setup();
  db.prepare("UPDATE profiles SET is_verified=0 WHERE id='admin'").run();
  assert.equal((await login(true,"admin@example.invalid")).requiresOtp,false);
  assert.equal(await guard.currentUserId(),"admin");assert.equal(sends.length,0);
  session={};assert.equal((await login()).requiresOtp,true);
});
test("signup still verifies, but cannot authorize a different browser using only a signup OTP",async()=>{
  await setup();
  const result=await registerAccount({data:{email:"new@example.invalid",password,fullName:"Fixture Member",phone:"",referralCode:""}});
  assert.equal(result.ok,true);assert.equal(await guard.currentUserId(),null);
  const code=sends.at(-1).text, pending={...session};
  session={};
  await assert.rejects(()=>verifyOtpCode({data:{email:"new@example.invalid",purpose:"signup",code}}),/start again/);
  session=pending;
  assert.equal((await verifyOtpCode({data:{email:"new@example.invalid",purpose:"signup",code}})).ok,true);
  assert.ok(await guard.currentUserId());
});
for (const mode of ["expired signup session","sign-in before verification"]) test(`${mode} resumes signup verification and awards inviter once`,async()=>{
  await setup();
  const email="recover@example.invalid";
  const registration=await registerAccount({data:{email,password,fullName:"Recovery Fixture",phone:"",referralCode:""}});
  assert.equal(registration.ok,true);
  db.prepare("INSERT INTO wallets(id,user_id,balance_naira,locked_naira,created_at,updated_at) VALUES('inviter-wallet','member',0,0,'now','now')").run();
  db.prepare("UPDATE profiles SET referred_by='member' WHERE email=?").run(email);
  if(mode==="expired signup session") {
    db.prepare("UPDATE sessions SET expires_at='2000-01-01'").run();
    assert.equal(await guard.currentUserId(),null);
  }
  const attempt=await login(true,email);
  assert.equal(attempt.ok,true);assert.equal(attempt.requiresOtp,true);assert.equal(attempt.otpPurpose,"signup");
  assert.equal(await guard.currentUserId(),null);
  // Simulate the resend cooldown elapsing; no real email or clocks involved.
  db.prepare("UPDATE otp_codes SET created_at=?").run(new Date(Date.now()-61000).toISOString());
  assert.equal((await requestOtp({data:{email,purpose:attempt.otpPurpose}})).ok,true);
  const code=sends.at(-1).text;
  assert.equal((await verifyOtpCode({data:{email,purpose:attempt.otpPurpose,code}})).ok,true);
  assert.equal(db.prepare("SELECT is_verified FROM profiles WHERE email=?").get(email).is_verified,1);
  assert.equal(db.prepare("SELECT balance_naira FROM wallets WHERE user_id='member'").get().balance_naira,200000);
  const wallet=db.prepare("SELECT balance_naira,locked_naira FROM wallets WHERE user_id=?").get(registration.userId);
  assert.equal(wallet.balance_naira,500000);assert.equal(wallet.locked_naira,500000);
  await assert.rejects(()=>verifyOtpCode({data:{email,purpose:"signup",code}}),/start again/);
  assert.equal(db.prepare("SELECT balance_naira FROM wallets WHERE user_id='member'").get().balance_naira,200000);
  assert.equal((await login(true,email)).otpPurpose,"login");
});
