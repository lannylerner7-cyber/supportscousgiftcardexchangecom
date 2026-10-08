import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
let db, user="member", failPut=false, loseCommit=false, loseFinalize=false;
const objects=new Map();
globalThis.__uploadTests={
  user:()=>user,
  queryOne:async(sql,p=[])=>db.prepare(sql).get(...p)??null,
  query:async(sql,p=[])=>db.prepare(sql).all(...p),
  execute:async(sql,p=[])=>{
    const result=db.prepare(sql).run(...p);
    if(loseFinalize && sql.startsWith("UPDATE trade_images")){loseFinalize=false;throw new Error("Lost finalization response");}
    return result;
  },
  transaction:async steps=>{
    db.exec("BEGIN");
    try {
      const rows=steps.map(s=>db.prepare(s.sql).all(...(s.params??[])));
      db.exec("COMMIT");
      if(loseCommit){loseCommit=false;throw new Error("Lost response");}
      return rows;
    }catch(e){if(db.isTransaction)db.exec("ROLLBACK");throw e;}
  },
  put:async(key,bytes,type)=>{objects.set(key,{bytes,type});if(failPut){failPut=false;throw new Error("Lost storage response");}},
};
const modules={
  "@tanstack/react-start":`export function createServerFn(){let v;return{inputValidator(f){v=f;return this},handler(f){return x=>f({data:v(x?.data)})}}}`,
  "@tanstack/react-router":`export const createFileRoute=()=>x=>x;`,
  "guard":`export const currentUserId=async()=>globalThis.__uploadTests.user();export const requireUserId=currentUserId;`,
  "d1":`export const {queryOne,query,execute,transaction}=globalThis.__uploadTests;export const newId=()=>crypto.randomUUID();export const nowIso=()=>new Date().toISOString();export const toNaira=n=>Number(n)/100;`,
  "r2":`export const putObject=globalThis.__uploadTests.put;export const extensionFor=t=>t==="image/png"?"png":"jpg";`,
};
registerHooks({resolve(s,c,next){
  let name=s.includes("guard.server")?"guard":s.includes("d1.server")?"d1":s.includes("r2.server")?"r2":s;
  if(modules[name])return{url:"data:text/javascript,"+encodeURIComponent(modules[name]),shortCircuit:true};
  if(s.startsWith("@/"))return{url:new URL("../src/"+s.slice(2)+".ts",import.meta.url).href,shortCircuit:true};
  try{return next(s,c)}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e}
}});
const {createTrade}=await import("../src/lib/trade.functions.ts");
const {Route}=await import("../src/routes/api/uploads.ts");
function setup(){
  db=new DatabaseSync(":memory:");objects.clear();user="member";failPut=false;loseCommit=false;loseFinalize=false;
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  for(const id of ["member","other"]){
    db.prepare("INSERT INTO users VALUES(?,?,?,NULL,NULL,'now','now')").run(id,id+"@example.invalid","fixture");
    db.prepare("INSERT INTO profiles(id,email,created_at,updated_at) VALUES(?,?,'now','now')").run(id,id+"@example.invalid");
  }
  db.exec(`INSERT INTO gift_card_brands(id,name,slug,created_at,updated_at) VALUES('fixture-brand','Fixture','fixture','now','now');
  INSERT INTO gift_card_regions(id,code,name) VALUES('fixture-region','TEST','Test region');
  INSERT INTO gift_card_variants VALUES('fixture-variant','fixture-brand','fixture-region','physical',100,500000,10000,1,'now','now');`);
}
const payload=()=>({submissionId:crypto.randomUUID(),variantId:"fixture-variant",faceValue:25});
const count=table=>db.prepare("SELECT count(*) n FROM "+table).get().n;
function request(tradeId,n=0,type="image/png",name="proof.png"){
  const body=new FormData();body.append("tradeId",tradeId);
  body.append("file",new File([new Uint8Array([137,80,78,71,13,10,26,10,n])],name,{type}));
  return Route.server.handlers.POST({request:new Request("http://fixture/api/uploads",{method:"POST",body})});
}
test("concurrent submissions, payload conflicts, independent submissions and lost commit response",async()=>{
  setup();const data=payload();
  const results=await Promise.all(Array.from({length:6},()=>createTrade({data})));
  assert.equal(new Set(results.map(x=>x.id)).size,1);assert.equal(count("trades"),1);assert.equal(count("notifications"),1);
  await assert.rejects(createTrade({data:{...data,note:"changed"}}),/different details/);
  const second=payload();loseCommit=true;await assert.rejects(createTrade({data:second}),/Lost response/);
  await createTrade({data:second});assert.equal(count("trades"),2);assert.equal(count("notifications"),2);
  db.close();
});
test("concurrent identical photos and uncertain R2 response recover one row/object",async()=>{
  setup();const trade=await createTrade({data:payload()});failPut=true;
  assert.equal((await request(trade.id)).status,500);
  assert.equal(count("trade_images"),1);
  const results=await Promise.all([request(trade.id),request(trade.id),request(trade.id)]);
  assert.ok(results.every(r=>r.status===200));assert.equal(count("trade_images"),1);assert.equal(objects.size,1);
  assert.equal(db.prepare("SELECT kind FROM trade_images").get().kind,"card");
  db.close();
});
test("five-photo atomic limit, replay at capacity, ownership and separate trade scope",async()=>{
  setup();const trade=await createTrade({data:payload()});
  const responses=await Promise.all(Array.from({length:8},(_,i)=>request(trade.id,i)));
  assert.equal(responses.filter(r=>r.status===200).length,5);assert.equal(count("trade_images"),5);
  assert.equal((await request(trade.id,0)).status,200);
  user="other";assert.equal((await request(trade.id,0)).status,403);
  user=null;assert.equal((await request(trade.id,0)).status,401);
  user="member";const other=await createTrade({data:payload()});
  assert.equal((await request(other.id,0)).status,200);assert.equal(count("trade_images"),6);
  db.close();
});
test("empty MIME fallback, incorrect signature and reviewed trades",async()=>{
  setup();const trade=await createTrade({data:payload()});
  assert.equal((await request(trade.id,0,"","proof.png")).status,200);
  assert.equal((await request(trade.id,0,"image/jpeg","proof.jpg")).status,400);
  db.prepare("UPDATE trades SET status='error' WHERE id=?").run(trade.id);
  assert.equal((await request(trade.id,0)).status,200);
  assert.equal((await request(trade.id,1)).status,409);
  db.close();
});
test("lost image finalization response preserves the committed object on replay",async()=>{
  setup();const trade=await createTrade({data:payload()});loseFinalize=true;
  assert.equal((await request(trade.id)).status,500);
  assert.equal((await request(trade.id)).status,200);
  assert.equal(count("trade_images"),1);assert.equal(objects.size,1);
  db.close();
});
test("shared validator rejects empty/oversize/unsupported and recognizes HEIC headers",async()=>{
  const {checkImage,imageType,matchesImage,MAX_IMAGE_BYTES}=await import("../src/lib/image-validation.ts");
  assert.ok(checkImage("image/png",0));assert.ok(checkImage("image/png",MAX_IMAGE_BYTES+1));
  assert.ok(checkImage("image/svg+xml",100));assert.equal(checkImage("image/png",MAX_IMAGE_BYTES),null);
  assert.equal(imageType("","PHONE.HEIC"),"image/heic");
  assert.equal(imageType("application/octet-stream","PHONE.heif"),"image/heif");
  assert.equal(matchesImage(new Uint8Array([0,0,0,24,...new TextEncoder().encode("ftypheic")]),"image/heic"),true);
});
