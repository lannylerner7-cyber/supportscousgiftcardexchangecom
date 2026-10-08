import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
let db,cookie={},failAfter=0,pushFailure=0;
const pushes=[];
const member="10000000-0000-4000-8000-000000000001",admin="10000000-0000-4000-8000-000000000002";
globalThis.__lifecycle={
  session:()=>({data:cookie,update:async v=>Object.assign(cookie,v),clear:async()=>{cookie={};}}),
  query:async(s,p=[])=>db.prepare(s).all(...p.map(x=>typeof x==="boolean"?+x:x)),
  queryOne:async(s,p=[])=>db.prepare(s).get(...p.map(x=>typeof x==="boolean"?+x:x))??null,
  execute:async(s,p=[])=>db.prepare(s).run(...p.map(x=>typeof x==="boolean"?+x:x)),
  transaction:async steps=>{
    db.exec("BEGIN");try{
      const result=steps.map((s,i)=>{if(failAfter && i===failAfter)throw Error("Simulated write failure");return db.prepare(s.sql).all(...(s.params??[]).map(x=>typeof x==="boolean"?+x:x));});
      db.exec("COMMIT");return result;
    }catch(e){db.exec("ROLLBACK");throw e;}
  },
  send:async (...args)=>{pushes.push(args);if(pushFailure)throw {statusCode:pushFailure};},
};
const modules={
  "@tanstack/react-start":`export function createServerFn(){let v;return{inputValidator(f){v=f;return this},handler(f){return x=>f({data:v?v(x?.data):undefined})}}}`,
  "@tanstack/react-start/server":`export const useSession=async()=>globalThis.__lifecycle.session();export const getRequest=()=>new Request("https://fixture.test/");`,
  d1:`export const {query,queryOne,execute,transaction}=globalThis.__lifecycle;export const publicQuery=query;export const nowIso=()=>new Date().toISOString();export const newId=()=>crypto.randomUUID();`,
  push:`export const pushKeys=async()=>({publicKey:"fixture",privateKey:"fixture"});export const webPush={sendNotification:globalThis.__lifecycle.send};`,
};
registerHooks({resolve(s,c,next){
  const key=s.includes("d1.server")?"d1":s==="./push.server"||s==="../src/lib/push.server.ts"?"push":s;
  if(modules[key])return {url:"data:text/javascript,"+encodeURIComponent(modules[key]),shortCircuit:true};
  try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}
}});
const guard=await import("../src/lib/guard.server.ts");
const {requestClosure,reviewClosure}=await import("../src/lib/closure.functions.ts");
const {requestReactivation}=await import("../src/lib/reactivation.functions.ts");
const {closureBlock}=await import("../src/lib/closure-policy.ts");
const {validPushEndpoint}=await import("../src/lib/push-policy.ts");
const {startDelivery,deliver}=await import("../src/lib/delivery.server.ts");
const {savePush,removePush,thisDeviceEnabled}=await import("../src/lib/push.functions.ts");
const {saveNativePush,nativePushStatus}=await import("../src/lib/native-push.functions.ts");
const {listHomepageBrands,listBrands}=await import("../src/lib/catalog.functions.ts");
const {suppliedBrandSlugs}=await import("../src/lib/brand-art.ts");
const {signIn,deleteAccount}=await import("../src/lib/account.functions.ts");
const password="test-only-password-not-a-real-account";
process.env.SESSION_SECRET="local-fixture-session-secret-not-used-for-real-accounts";
async function setup(){
  db?.close();db=new DatabaseSync(":memory:");cookie={};failAfter=0;pushFailure=0;pushes.length=0;
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  const hash=await guard.hashPassword(password);
  for(const [id,role] of [[member,"user"],[admin,"admin"]]){
    db.prepare("INSERT INTO users VALUES(?,?,?,NULL,NULL,'now','now')").run(id,id+"@example.invalid",hash);
    db.prepare("INSERT INTO profiles(id,email,created_at,updated_at) VALUES(?,?,'now','now')").run(id,id+"@example.invalid");
    db.prepare("INSERT INTO wallets(id,user_id,balance_naira,locked_naira,created_at,updated_at) VALUES(?,?,500000,500000,'now','now')").run(id+"-wallet",id);
    db.prepare("INSERT INTO user_roles VALUES(?,?,?,'now')").run(id+"-role",id,role);
  }
  await guard.startSession(member,member+"@example.invalid");
}
async function request(waive=true){
  await requestClosure({data:{password,waiveLocked:waive,confirmation:"DEACTIVATE"}});
  return db.prepare("SELECT id FROM account_closures WHERE user_id=?").get(member).id;
}
async function adminSession(){await guard.startSession(admin,admin+"@example.invalid");}
test("closure consent, wrong password, duplicate request, all-session revocation and retained data",async()=>{
  await setup();
  await assert.rejects(()=>requestClosure({data:{password:"wrong",waiveLocked:true,confirmation:"DEACTIVATE"}}),/incorrect/);
  const id=await request();await request();
  assert.equal(db.prepare("SELECT count(*) c FROM account_closures").get().c,1);
  await guard.startSession(member,member+"@example.invalid");const oldCookie={...cookie};
  await adminSession();
  await reviewClosure({data:{id,action:"close",note:"Settlement reviewed; promotional waiver confirmed."}});
  assert.equal(db.prepare("SELECT balance_naira FROM wallets WHERE user_id=?").get(member).balance_naira,0);
  assert.equal(db.prepare("SELECT count(*) c FROM sessions WHERE user_id=?").get(member).c,0);
  assert.ok(db.prepare("SELECT id FROM users WHERE id=?").get(member));
  cookie=oldCookie;assert.equal(await guard.currentUserId(),null);
  await assert.rejects(()=>guard.startSession(member,member+"@example.invalid"),/inactive/);
  assert.equal((await signIn({data:{email:member+"@example.invalid",password}})).ok,false);
});
test("no consent, real funds, pending activity and last administrator block closure",async()=>{
  await setup();const id=await request(false);await adminSession();
  await assert.rejects(()=>reviewClosure({data:{id,action:"close",note:"Review completed."}}),/Confirm/);
  assert.ok(closureBlock(600000,0,500000,0,false,true));
  assert.ok(closureBlock(500000,0,500000,1,false,true));
  assert.ok(closureBlock(500000,100,500000,0,false,true));
  assert.ok(closureBlock(0,0,0,0,true,true));
  assert.equal(closureBlock(0,0,0,0,false,false),null);
  await requestClosure({data:{password,waiveLocked:true,confirmation:"DEACTIVATE"}});
  const adminRequest=db.prepare("SELECT id FROM account_closures WHERE user_id=?").get(admin).id;
  await assert.rejects(()=>reviewClosure({data:{id:adminRequest,action:"close",note:"Review completed."}}),/last active administrator/);
  assert.equal(db.prepare("SELECT deleted_at FROM profiles WHERE id=?").get(admin).deleted_at,null);
});
test("cleanup write failure rolls back wallet, closure and session revocation together",async()=>{
  await setup();const id=await request();await adminSession();failAfter=5;
  await assert.rejects(()=>reviewClosure({data:{id,action:"close",note:"Review completed."}}),/Simulated/);
  assert.equal(db.prepare("SELECT deleted_at FROM profiles WHERE id=?").get(member).deleted_at,null);
  assert.equal(db.prepare("SELECT balance_naira FROM wallets WHERE user_id=?").get(member).balance_naira,500000);
  assert.equal(db.prepare("SELECT status FROM account_closures WHERE id=?").get(id).status,"requested");
});
test("reactivation needs email proof and admin approval, and does not revive old sessions",async()=>{
  await setup();const oldCookie={...cookie},id=await request();await adminSession();
  await reviewClosure({data:{id,action:"close",note:"Review completed."}});
  await assert.rejects(()=>reviewClosure({data:{id,action:"reactivate",note:"Review completed."}}),/verify/);
  const email=member+"@example.invalid",otpId=crypto.randomUUID();
  db.prepare("INSERT INTO otp_codes(id,email,purpose,code_hash,expires_at,created_at) VALUES(?,?,'reset',?,?,?)")
    .run(otpId,email,await guard.sha256Hex(email+":reactivation:123456"),new Date(Date.now()+300000).toISOString(),new Date().toISOString());
  await assert.rejects(()=>requestReactivation({data:{email,code:"999999"}}),/Invalid/);
  await requestReactivation({data:{email,code:"123456"}});
  await reviewClosure({data:{id,action:"reactivate",note:"Email ownership and case verified."}});
  assert.equal(db.prepare("SELECT deleted_at FROM profiles WHERE id=?").get(member).deleted_at,null);
  cookie=oldCookie;assert.equal(await guard.currentUserId(),null);
  await guard.startSession(member,email);assert.equal(await guard.currentUserId(),member);
  await assert.rejects(()=>deleteAccount({data:{password}}),/Direct deletion is disabled/);
});
test("push subscriptions are owned, opt-out removes deliveries, events deduplicate and payload stays generic",async()=>{
  await setup();
  const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/fixture",keys:{p256dh:"A".repeat(87),auth:"A".repeat(22)}};
  await savePush({data:subscription});
  await adminSession();assert.equal((await thisDeviceEnabled({data:{endpoint:subscription.endpoint}})).enabled,false);
  await assert.rejects(()=>savePush({data:subscription}),/existing push/);
  await removePush({data:{endpoint:subscription.endpoint}});
  assert.equal(db.prepare("SELECT count(*) c FROM device_push").get().c,1);
  await guard.startSession(member,member+"@example.invalid");
  db.prepare("INSERT INTO notifications(id,user_id,title,body,created_at) VALUES('push-test',?,'Sensitive balance','NEVER SEND BANK DETAILS',?)").run(member,new Date(Date.now()+1000).toISOString());
  startDelivery("https://fixture.test");await deliver();await deliver();
  assert.equal(pushes.length,1);assert.ok(!pushes[0][1].includes("BANK"));
  assert.equal(db.prepare("SELECT count(*) c FROM push_deliveries").get().c,1);
  await removePush({data:{all:true}});
  assert.equal(db.prepare("SELECT count(*) c FROM device_push").get().c,0);
  assert.equal(db.prepare("SELECT count(*) c FROM push_deliveries").get().c,0);
});
test("expired endpoints removed and unsafe endpoint URLs rejected",async()=>{
  await setup();pushFailure=410;
  for(const endpoint of ["http://fcm.googleapis.com/x","https://127.0.0.1/x","https://fcm.googleapis.com.evil.test/x","https://user@fcm.googleapis.com/x","https://fcm.googleapis.com:8443/x"])assert.equal(validPushEndpoint(endpoint),false);
  await savePush({data:{endpoint:"https://web.push.apple.com/fixture",keys:{p256dh:"A".repeat(87),auth:"A".repeat(22)}}});
  db.prepare("INSERT INTO notifications(id,user_id,title,created_at) VALUES('expired-test',?,'Update',?)").run(member,new Date(Date.now()+1000).toISOString());
  startDelivery("https://fixture.test");await deliver();
  assert.equal(db.prepare("SELECT count(*) c FROM device_push").get().c,0);
});
test("actual review refuses real funds, pending withdrawals and inactive trade writes",async()=>{
  await setup();const id=await request();await adminSession();
  db.prepare("UPDATE wallets SET balance_naira=600000 WHERE user_id=?").run(member);
  await assert.rejects(()=>reviewClosure({data:{id,action:"close",note:"Reviewed by the desk."}}),/Withdraw/);
  db.prepare("UPDATE wallets SET balance_naira=500000 WHERE user_id=?").run(member);
  db.prepare(`INSERT INTO withdrawals(id,user_id,amount,net_amount,status,created_at,updated_at)
    VALUES('pending-fixture',?,100000,70000,'requested','now','now')`).run(member);
  await assert.rejects(()=>reviewClosure({data:{id,action:"close",note:"Reviewed by the desk."}}),/settled/);
  db.prepare("UPDATE withdrawals SET status='cancelled' WHERE id='pending-fixture'").run();
  await reviewClosure({data:{id,action:"close",note:"Reviewed by the desk."}});
  assert.throws(()=>db.prepare(`INSERT INTO trades(id,user_id,brand_name,region_code,card_type,face_value,currency,rate_at_submit,expected_payout,created_at,updated_at)
    VALUES('late-trade',?,'Test','TEST','physical',25,'USD',1,25,'now','now')`).run(member),/inactive/);
});
test("expired worker lease recovers and stale acknowledgement cannot own the job",async()=>{
  await setup();
  await savePush({data:{endpoint:"https://fcm.googleapis.com/fcm/send/crash-fixture",keys:{p256dh:"A".repeat(87),auth:"A".repeat(22)}}});
  db.prepare("INSERT INTO notifications(id,user_id,title,created_at) VALUES('crash-test',?,'Update',?)").run(member,new Date(Date.now()+1000).toISOString());
  const device=db.prepare("SELECT id FROM device_push LIMIT 1").get();
  db.prepare(`INSERT INTO push_deliveries(id,device_id,notification_id,next_at,lease_token,lease_until,attempts)
    VALUES('crash-job',?,'crash-test','2000','dead-worker','2999',1)`).run(device.id);
  startDelivery("https://fixture.test");await deliver();assert.equal(pushes.length,0);
  db.prepare("UPDATE push_deliveries SET lease_until='2000'").run();
  await deliver();assert.equal(pushes.length,1);
  assert.equal(db.prepare("UPDATE push_deliveries SET sent_at=NULL WHERE id='crash-job' AND lease_token='dead-worker'").run().changes,0);
  await deliver();assert.equal(pushes.length,1);
});
test("temporary push failures back off and stop after five attempts",async()=>{
  await setup();pushFailure=503;
  await savePush({data:{endpoint:"https://fcm.googleapis.com/fcm/send/retry-fixture",keys:{p256dh:"A".repeat(87),auth:"A".repeat(22)}}});
  db.prepare("INSERT INTO notifications(id,user_id,title,created_at) VALUES('retry-test',?,'Update',?)").run(member,new Date(Date.now()+1000).toISOString());
  startDelivery("https://fixture.test");
  for(let i=0;i<7;i++){
    await deliver();
    db.prepare("UPDATE push_deliveries SET next_at='2000-01-01'").run();
  }
  assert.equal(pushes.length,5);
  assert.equal(db.prepare("SELECT attempts FROM push_deliveries").get().attempts,5);
});
test("native registration needs provider setup, is owned, and disappears on sign-out or global opt-out",async()=>{
  await setup();
  // Unit-test this worker's configuration explicitly, regardless of workspace secrets.
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  const subscription={platform:"android",token:"fixture-token-not-a-real-device-123456789"};
  await assert.rejects(()=>saveNativePush({data:subscription}),/not configured/);
  process.env.FCM_SERVICE_ACCOUNT_JSON="fixture-enabled-without-network";
  try{
    await saveNativePush({data:subscription});
    await saveNativePush({data:subscription});
    assert.equal(db.prepare("SELECT count(*) c FROM native_push_devices").get().c,1);
    assert.equal((await nativePushStatus({data:{platform:"android"}})).enabled,true);
    const original={...cookie};await adminSession();
    await assert.rejects(()=>saveNativePush({data:subscription}),/previous account/);
    cookie=original;
    await removePush({data:{all:true}});
    assert.equal(db.prepare("SELECT count(*) c FROM native_push_devices").get().c,0);
    await saveNativePush({data:subscription});await guard.endSession();
    assert.equal(db.prepare("SELECT count(*) c FROM native_push_devices").get().c,0);
  }finally{delete process.env.FCM_SERVICE_ACCOUNT_JSON;}
});

test("actual homepage query renders all supplied brands on the checked-in schema without changing trading rows or rates",async()=>{
  await setup();
  const beforeBrands=db.prepare("SELECT * FROM gift_card_brands ORDER BY id").all();
  const beforeVariants=db.prepare("SELECT * FROM gift_card_variants ORDER BY id").all();
  const enabledBefore=await listBrands();
  const rendered=await listHomepageBrands();
  for(const slug of suppliedBrandSlugs){
    const items=rendered.filter(item=>item.slug===slug);
    assert.equal(items.length,1,slug);
    assert.ok(items[0].logo_url?.startsWith("/brands/"),slug);
    const row=beforeBrands.find(brand=>brand.slug===slug);
    assert.equal(items[0].catalogueOnly,!row?.is_visible,slug);
    if(!row)assert.match(items[0].id,/^showcase:/);
  }
  assert.equal(rendered.find(item=>item.slug==="nintendo").catalogueOnly,true);
  assert.deepEqual(await listBrands(),enabledBefore);
  assert.deepEqual(db.prepare("SELECT * FROM gift_card_brands ORDER BY id").all(),beforeBrands);
  assert.deepEqual(db.prepare("SELECT * FROM gift_card_variants ORDER BY id").all(),beforeVariants);
  db.exec("DELETE FROM gift_card_variants; DELETE FROM gift_card_brands;");
  const emptyCatalogue=await listHomepageBrands();
  assert.equal(emptyCatalogue.length,65);
  assert.ok(emptyCatalogue.every(item=>item.catalogueOnly&&item.id.startsWith("showcase:")));
  assert.deepEqual(await listBrands(),[]);
});
