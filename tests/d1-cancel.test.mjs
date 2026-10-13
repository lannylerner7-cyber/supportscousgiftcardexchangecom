import {test} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";

globalThis.__d1CancelTest={};
const modules={
  "./cloudflare-fetch.server":`export const cloudflareFetch=(url,init)=>globalThis.__d1CancelTest.fetch(url,init);export const usesReplitCloudflare=()=>true;`,
  "./public-cache.server":`export const publicCache={clear(){},read(_key,load){return load();}};`,
  "./observability.server":`export const measure=()=>{};`,
};
registerHooks({resolve(specifier,context,next){
  if(modules[specifier])return {url:"data:text/javascript,"+encodeURIComponent(modules[specifier]),shortCircuit:true};
  try{return next(specifier,context);}
  catch(error){
    if(specifier.startsWith("./")&&!specifier.endsWith(".ts"))return next(specifier+".ts",context);
    throw error;
  }
}});

process.env["CLOUDFLARE_ACCOUNT_ID"]="test-account";
process.env["D1_DATABASE_ID"]="test-database";
const {query}=await import("../src/lib/d1.server.ts");
test("D1 reads pass request cancellation through to the HTTP fetch",async()=>{
  let captured;
  let fetched;
  const fetchStarted=new Promise(resolve=>{fetched=resolve;});
  globalThis.__d1CancelTest.fetch=async(_url,init)=>{
    captured=init.signal;
    fetched();
    return new Promise((_resolve,reject)=>{
      if(init.signal.aborted)reject(init.signal.reason);
      else init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true});
    });
  };
  const controller=new AbortController();
  const pending=query("SELECT 1",[],controller.signal);
  await fetchStarted;
  assert.equal(captured.aborted,false);
  controller.abort();
  await assert.rejects(pending,{name:"AbortError"});
});
