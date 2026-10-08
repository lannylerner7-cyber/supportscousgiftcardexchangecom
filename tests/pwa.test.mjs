import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { PUBLIC_PATHS, SITE_ORIGIN, publicHead } from "../src/lib/public-site.ts";

test("public sitemap allowlist and canonical metadata exclude private routes",()=>{
  assert.deepEqual(PUBLIC_PATHS,["/","/rates","/support","/privacy","/terms"]);
  for(const path of PUBLIC_PATHS){
    const head=publicHead(path,"Title","Description");
    assert.equal(head.links[0].href,SITE_ORIGIN+path);
    assert.ok(head.meta.some(x=>x.property==="og:image"));
  }
});
test("service worker never caches account pages, APIs, proofs or mutations",async()=>{
  const handlers={};const assets=[];const writes=[];let offline=false;
  const context={
    self:{location:{origin:SITE_ORIGIN},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn},
    caches:{
      open:async()=>({addAll:async paths=>assets.push(...paths),put:(...args)=>writes.push(args)}),
      match:async()=>new Response("generic offline fallback"),
      keys:async()=>[],
    },
    fetch:async()=>{if(offline)throw Error("offline");return new Response("private response");},
    URL,Response,
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js",import.meta.url),"utf8"),context);
  let promise;handlers.install({waitUntil:p=>promise=p});await promise;
  assert.deepEqual(assets,["/offline.html","/icon-192.png","/icon-512.png","/icon-maskable.png"]);
  for(const path of ["/app","/app/history/test","/login"]){
    handlers.fetch({request:{method:"GET",url:SITE_ORIGIN+path,mode:"navigate"},respondWith:p=>promise=p});
    assert.equal(await(await promise).text(),"private response");
  }
  for(const [path,method] of [["/api/files/private.png","GET"],["/api/uploads","POST"],["/_server/example","POST"]]){
    let intercepted=false;
    handlers.fetch({request:{method,url:SITE_ORIGIN+path},respondWith:()=>intercepted=true});
    assert.equal(intercepted,false);
  }
  offline=true;
  handlers.fetch({request:{method:"GET",url:SITE_ORIGIN+"/app",mode:"navigate"},respondWith:p=>promise=p});
  assert.equal(await(await promise).text(),"generic offline fallback");
  assert.equal(writes.length,0);
});
test("manifest icons are real PNGs with declared dimensions",()=>{
  const manifest=JSON.parse(readFileSync(new URL("../public/manifest.webmanifest",import.meta.url)));
  assert.equal(manifest.scope,"/");assert.equal(manifest.start_url,"/");
  for(const icon of manifest.icons){
    const data=readFileSync(new URL("../public"+icon.src,import.meta.url));
    assert.equal(data.toString("ascii",1,4),"PNG");
    assert.equal(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`,icon.sizes);
  }
});
