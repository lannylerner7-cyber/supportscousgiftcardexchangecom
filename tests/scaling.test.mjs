import {test} from "node:test";
import assert from "node:assert/strict";
import {PublicCache} from "../src/lib/public-cache.server.ts";
import {observedRequest} from "../src/lib/observability.server.ts";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";

test("public cache coalesces, expires, bounds keys and invalidates in-flight results",async()=>{
  const cache=new PublicCache(20,2);let calls=0;
  const load=async()=>++calls;
  assert.deepEqual(await Promise.all(Array.from({length:100},()=>cache.read("a",load))),Array(100).fill(1));
  cache.clear();assert.equal(await cache.read("a",load),2);
  await cache.read("b",load);await cache.read("c",load);
  assert.equal(await cache.read("a",load),5);
  await new Promise(r=>setTimeout(r,25));assert.equal(await cache.read("a",load),6);
  let resolve;const pending=cache.read("old",()=>new Promise(r=>resolve=r));
  await Promise.resolve();cache.clear();resolve("stale");await pending;
  assert.equal(await cache.read("old",async()=>"fresh"),"fresh");
});
test("provider outage is not cached as public data and recovery succeeds",async()=>{
  const cache=new PublicCache();let calls=0;
  const load=async()=>{calls++;throw Error("fixture outage");};
  await assert.rejects(cache.read("a",load));await assert.rejects(cache.read("a",load));
  assert.equal(calls,2);assert.equal(await cache.read("a",async()=>"recovered"),"recovered");
});
test("request admission is bounded and capacity recovers without logging identity",async()=>{
  const releases=[];
  const active=Array.from({length:128},()=>observedRequest(()=>new Promise(resolve=>releases.push(resolve))));
  const rejected=await observedRequest(async()=>new Response("unexpected"));
  assert.equal(rejected.status,503);assert.equal(rejected.headers.get("Retry-After"),"5");
  releases.forEach(resolve=>resolve(new Response("ok")));
  const completed=await Promise.all(active);
  assert.equal(new Set(completed.map(r=>r.headers.get("X-Request-ID"))).size,128);
  assert.equal((await observedRequest(async()=>new Response("ok"))).status,200);
});
test("due job query uses a partial index rather than scanning sent history",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8"));
  const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM push_deliveries
    WHERE sent_at IS NULL AND terminal=0 AND attempts<5 AND next_at<=?
    AND (lease_until IS NULL OR lease_until<?) ORDER BY next_at LIMIT 20`).all("now","now");
  assert.match(JSON.stringify(plan),/idx_push_due/);
  db.close();
});
