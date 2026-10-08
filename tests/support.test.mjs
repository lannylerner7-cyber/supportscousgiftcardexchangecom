import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
let db,cookie={},mails=[],failMail=false,loseResponse=false,requests=0;
const objects=new Map();
globalThis.__supportTest={
  session:()=>({data:cookie}),
  query:async(sql,p=[])=>{requests++;return db.prepare(sql).all(...p);},
  queryOne:async(sql,p=[])=>{requests++;return db.prepare(sql).get(...p)??null;},
  execute:async(sql,p=[])=>{
    requests++;const out=db.prepare(sql).run(...p);
    if(loseResponse&&sql.startsWith("INSERT INTO chat_messages")){loseResponse=false;throw Error("response lost");}
    return out;
  },
  transaction:async steps=>{
    requests++;db.exec("BEGIN");
    try{const out=steps.map(s=>db.prepare(s.sql).all(...(s.params??[])));db.exec("COMMIT");return out;}
    catch(e){db.exec("ROLLBACK");throw e;}
  },
  send:async input=>{mails.push(input);return {sent:!failMail};},
  put:async(key,bytes,type)=>objects.set(key,{bytes,type}),
  remove:async key=>objects.delete(key),
};
const modules={
  "@tanstack/react-start/server":`export const useSession=async()=>globalThis.__supportTest.session();`,
  d1:`export const {query,queryOne,execute,transaction}=globalThis.__supportTest;export const nowIso=()=>new Date().toISOString();`,
  email:`export const sendEmail=globalThis.__supportTest.send;export const supportAlertEmail=link=>({subject:"New support message",text:link,html:link});`,
  r2:`export const putObject=globalThis.__supportTest.put;export const deleteObject=globalThis.__supportTest.remove;`,
};
registerHooks({resolve(s,c,next){
  const key=s.includes("d1.server")?"d1":s.includes("email.server")?"email":s.includes("r2.server")?"r2":s;
  if(modules[key])return {url:"data:text/javascript,"+encodeURIComponent(modules[key]),shortCircuit:true};
  try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}
}});
const {supportAction:action,supportActor,limit}=await import("../src/lib/support.server.ts");
const {SupportHub}=await import("../src/lib/support-stream.server.ts");
const {deliverSupportMail,cleanSupportOrphans}=await import("../src/lib/support-delivery.server.ts");
const {uploadSupportImage}=await import("../src/lib/support-uploads.server.ts");
const sharp=(await import("sharp")).default;
const member="11111111-1111-4111-8111-111111111111",admin="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
function login(id){cookie={userId:id,sessionId:id+"-session"};}
function setup(){
  db?.close();db=new DatabaseSync(":memory:");mails=[];objects.clear();failMail=false;loseResponse=false;requests=0;
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  for(const id of [member,admin,other]){
    db.prepare("INSERT INTO users(id,email,password_hash,created_at,updated_at) VALUES(?,?,'fixture','now','now')").run(id,id+"@example.invalid");
    db.prepare("INSERT INTO profiles(id,email,created_at,updated_at) VALUES(?,?,'now','now')").run(id,id+"@example.invalid");
    db.prepare("INSERT INTO sessions VALUES(?,?,'2099-01-01','now')").run(id+"-session",id);
  }
  db.prepare("INSERT INTO user_roles VALUES('admin',?,'admin','now')").run(admin);
  db.exec(`INSERT INTO app_settings(id,alert_emails,updated_at) VALUES(1,'["fixture@example.invalid"]','now')`);
  login(member);
}
const send=(threadId,body="private card code",id=crypto.randomUUID(),imagePath)=>action({action:"send",threadId,body,id,...(imagePath?{imagePath}:{})});
const count=t=>db.prepare("SELECT count(*) c FROM "+t).get().c;
test("concurrent creation, durable text/image intent, ambiguous retry, read cursors and resolve/reopen",async()=>{
  setup();
  const [{thread:t},{thread:t2}]=await Promise.all([action({action:"open"}),action({action:"open"})]);
  assert.equal(t.id,t2.id);assert.equal(count("chat_threads"),1);
  const id=crypto.randomUUID();loseResponse=true;
  await assert.rejects(()=>send(t.id,"secret",id),/lost/);
  await send(t.id,"secret",id);
  assert.equal(count("chat_messages"),1);assert.equal(count("support_mail"),1);
  await assert.rejects(()=>send(t.id,"different",id),/differs/);
  login(admin);await action({action:"join",threadId:t.id});
  let history=await action({action:"history",threadId:t.id});
  assert.ok(history.thread.joined_until);assert.equal(history.thread.unread_for_admin,1);
  await action({action:"read",threadId:t.id,seq:history.messages[0].seq});
  assert.equal((await action({action:"summary"})).unread,0);
  await send(t.id,"reply");
  assert.equal(count("support_mail"),1);
  await action({action:"resolve",threadId:t.id,resolved:true});
  login(member);
  assert.equal((await action({action:"history",threadId:t.id})).thread.resolved,1);
  await send(t.id,"new question");
  history=await action({action:"history",threadId:t.id});
  assert.equal(history.thread.resolved,0);assert.equal(history.messages.length,3);
  login(other);await assert.rejects(()=>action({action:"history",threadId:t.id}),/not found/);
  await assert.rejects(()=>send(t.id),/not found/);
  login(member);db.prepare("DELETE FROM sessions WHERE user_id=?").run(member);
  await assert.rejects(()=>action({action:"history",threadId:t.id}),/sign in/);
});
test("ordered pagination, image validation/ownership/atomic attachment claim and conservative cleanup",async()=>{
  setup();const {thread:t}=await action({action:"open"});
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer();
  const buf=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const id=crypto.randomUUID();
  const upload=await uploadSupportImage(t.id,id,buf);
  assert.equal((await uploadSupportImage(t.id,id,buf)).path,upload.path);
  await send(t.id,"",crypto.randomUUID(),upload.path);
  assert.equal(count("support_mail"),1);
  await assert.rejects(()=>send(t.id,"reuse",crypto.randomUUID(),upload.path),/Attachment/);
  assert.equal(count("chat_messages"),1);
  login(other);await assert.rejects(()=>uploadSupportImage(t.id,crypto.randomUUID(),buf),/not found/);
  login(admin);const adm=await uploadSupportImage(t.id,crypto.randomUUID(),buf);
  await send(t.id,"admin photo",crypto.randomUUID(),adm.path);
  assert.equal(count("support_mail"),1);
  await assert.rejects(()=>uploadSupportImage(t.id,crypto.randomUUID(),new TextEncoder().encode("<svg/>").buffer));
  // Seed additional committed rows to test pagination without bypassing actual triggers.
  for(let i=0;i<60;i++)db.prepare(`INSERT INTO chat_messages(id,thread_id,sender_id,sender_role,body,created_at) VALUES(?,?,?,'admin',?,'2026-01-01')`).run(crypto.randomUUID(),t.id,admin,String(i));
  const newest=await action({action:"history",threadId:t.id});
  const older=await action({action:"history",threadId:t.id,before:newest.messages[0].seq});
  assert.equal(newest.messages.length,50);assert.equal(older.messages.length,12);
  assert.equal(new Set([...older.messages,...newest.messages].map(m=>m.id)).size,62);
  assert.ok(older.messages.at(-1).seq<newest.messages[0].seq);
  const orphan=await uploadSupportImage(t.id,crypto.randomUUID(),buf);
  db.prepare("UPDATE support_attachments SET created_at='2020-01-01' WHERE path=?").run(orphan.path);
  await cleanSupportOrphans();
  assert.ok(!objects.has(orphan.path));assert.ok(objects.has(upload.path));
});
test("mail leases, bounded failure retries, diagnostics, recovery and generic alert",async()=>{
  setup();const {thread:t}=await action({action:"open"});await send(t.id,"DO NOT EMAIL THIS");
  failMail=true;await deliverSupportMail();
  assert.equal(db.prepare("SELECT attempts FROM support_mail").get().attempts,1);
  assert.equal(count("support_mail"),1);
  db.exec("UPDATE support_mail SET next_at='2000-01-01'");failMail=false;
  await Promise.all([deliverSupportMail(),deliverSupportMail()]);
  assert.equal(mails.length,2);assert.ok(db.prepare("SELECT sent_at FROM support_mail").get().sent_at);
  assert.ok(!JSON.stringify(mails).includes("DO NOT EMAIL THIS"));
  await send(t.id);failMail=true;
  for(let i=0;i<6;i++){db.exec("UPDATE support_mail SET next_at='2000-01-01'");await deliverSupportMail();}
  login(admin);assert.equal((await action({action:"diagnostics"})).exhausted,1);
});
test("two independent hubs replay shared commits, revoke roles/sessions and bounded shared polling",async()=>{
  setup();const {thread:t}=await action({action:"open"});
  const memberActor=await supportActor();login(admin);const adminActor=await supportActor();
  const a=new SupportHub(),b=new SupportHub(),controller=new AbortController();
  const ra=(await a.connect(memberActor,t.id,0,controller.signal)).body.getReader();
  const rb=(await b.connect(adminActor,t.id,0,controller.signal)).body.getReader();
  const decoder=new TextDecoder();
  async function until(reader,text){for(let i=0;i<20;i++){const {value,done}=await reader.read();if(done)throw Error("stream ended early");const s=decoder.decode(value);if(s.includes(text))return s;}throw Error("frame missing");}
  await until(ra,"ready");await until(rb,"ready");
  const timings=[];
  for(let i=0;i<5;i++){
    login(member);const start=performance.now();const result=await send(t.id,`latency-${i}`);
    const received=until(rb,result.message.id);
    await b.tick();await received;timings.push(performance.now()-start);
  }
  // Add watchers without network connections to measure DB request count per tick.
  const before=requests;await a.tick();assert.equal(requests-before,1);
  db.prepare("DELETE FROM user_roles WHERE user_id=?").run(admin);
  await b.tick();assert.match(await until(rb,"revoked"),/revoked/);
  db.prepare("UPDATE profiles SET deleted_at='now' WHERE id=?").run(member);
  await a.tick();assert.match(await until(ra,"revoked"),/revoked/);
  controller.abort();clearTimeout(a.timer);clearTimeout(b.timer);
  console.log("ISOLATED SQLite immediate hub tick commit-to-frame ms:",timings.map(n=>n.toFixed(2)).join(", "),
    "(excludes 750ms scheduler/network; NOT live D1 latency)");
});
test("shared atomic rate limit rejects bursts",async()=>{
  setup();const results=await Promise.allSettled(Array.from({length:35},()=>limit(member,"send",30)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,30);
  assert.equal(results.filter(r=>r.status==="rejected").length,5);
});
test("additive migration parser preserves full triggers and safely reapplies",async()=>{
  setup();
  const {statements}=await import("../scripts/apply-support-migration.mjs");
  assert.equal(statements.length,14);
  for(const statement of statements)db.exec(statement.sql);
  const {thread:t}=await action({action:"open"});
  await send(t.id);
  for(const statement of statements)db.exec(statement.sql);
  assert.equal(count("support_order"),1);assert.equal(count("support_mail"),1);
  const {supportReturn}=await import("../src/lib/support-return.ts");
  assert.equal(supportReturn("/app/chat"),"/app/chat");
  assert.equal(supportReturn("https://evil.invalid"),undefined);
  assert.equal(supportReturn("//evil.invalid"),undefined);
});
test("outbox failure rolls back message, unread counters and attachment linkage",async()=>{
  setup();const {thread:t}=await action({action:"open"});
  db.exec("CREATE TRIGGER fail_support_mail BEFORE INSERT ON support_mail BEGIN SELECT RAISE(ABORT,'mail intent failed'); END;");
  await assert.rejects(()=>send(t.id),/mail intent failed/);
  assert.equal(count("chat_messages"),0);assert.equal(count("support_order"),0);
  assert.equal(db.prepare("SELECT unread_for_admin FROM chat_threads").get().unread_for_admin,0);
});
test("closed Settings badge receives live unread counts without creating a thread or marking read",async()=>{
  setup();const actor=await supportActor(),hub=new SupportHub(),abort=new AbortController();
  const reader=(await hub.connect(actor,"summary",0,abort.signal)).body.getReader();
  const decoder=new TextDecoder();
  const until=async text=>{while(true){const {value,done}=await reader.read();if(done)throw Error("closed");const frame=decoder.decode(value);if(frame.includes(text))return frame;}};
  await hub.tick();assert.match(await until("summary"),/"unread":0/);
  assert.equal(count("chat_threads"),0);
  const {thread:t}=await action({action:"open"});login(admin);await send(t.id,"badge update");
  await hub.tick();assert.match(await until("summary"),/"unread":1/);
  assert.equal(db.prepare("SELECT unread_for_user FROM chat_threads").get().unread_for_user,1);
  abort.abort();clearTimeout(hub.timer);
});
test("scheduled delivery workload: 8 streams and 6 commits, one database read per tick",async()=>{
  setup();const {thread:t}=await action({action:"open"});
  const memberActor=await supportActor();login(admin);const adminActor=await supportActor();
  let reads=0;
  const hub=new SupportHub(async(sql,p)=>{reads++;return globalThis.__supportTest.query(sql,p);});
  const abort=new AbortController();const readers=[];
  for(let i=0;i<8;i++)readers.push((await hub.connect(i<4?memberActor:adminActor,t.id,0,abort.signal)).body.getReader());
  const decoder=new TextDecoder();
  async function until(reader,id){
    while(true){const frame=await reader.read();if(frame.done)throw Error("ended");if(decoder.decode(frame.value).includes(id))return;}
  }
  // Drain every subscriber so backpressure is representative of healthy readers.
  for(const reader of readers)await until(reader,"ready");
  const timings=[];
  for(let i=0;i<6;i++){
    login(member);const start=performance.now();const {message}=await send(t.id,`scheduled-${i}`);
    // Keep event loop alive: hub timers intentionally unref in the production server.
    const keep=setTimeout(()=>{},3000);
    await Promise.all(readers.map(r=>until(r,message.id)));
    clearTimeout(keep);timings.push(performance.now()-start);
  }
  abort.abort();clearTimeout(hub.timer);
  assert.ok(Math.max(...timings)<2000);
  assert.ok(reads<=8);
  const before=reads;await hub.tick();assert.equal(reads,before);
  console.log("ISOLATED scheduled SQLite workload: 8 streams / 6 messages; ms =",timings.map(t=>t.toFixed(1)).join(","),
    "; hub DB requests =",reads,"; idle empty hub = 0. No real D1/network included.");
});
