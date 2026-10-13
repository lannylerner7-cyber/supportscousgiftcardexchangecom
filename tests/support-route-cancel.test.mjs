import {test} from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";

globalThis.__supportRouteCancelTest={};
const modules={
  "@tanstack/react-router":`export const createFileRoute=path=>options=>({path,...options});`,
  "@/lib/bounded-body.server":`export const boundedBody=async request=>new TextEncoder().encode(await request.text());`,
  "@/lib/support.server":`export const supportAction=(...args)=>globalThis.__supportRouteCancelTest.action(...args);`,
};
registerHooks({resolve(specifier,context,next){
  if(modules[specifier])return {url:"data:text/javascript,"+encodeURIComponent(modules[specifier]),shortCircuit:true};
  return next(specifier,context);
}});

const {Route}=await import("../src/routes/api/support.ts");
test("support route passes the request abort signal to the open action",async()=>{
  let received;
  globalThis.__supportRouteCancelTest.action=async(input,signal)=>{
    received={input,signal};
    return {thread:{id:"support-test"}};
  };
  const controller=new AbortController();
  const request=new Request("https://example.invalid/api/support",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"open"}),
    signal:controller.signal,
  });
  const response=await Route.server.handlers.POST({request});
  assert.equal(response.status,200);
  assert.deepEqual(received.input,{action:"open"});
  assert.equal(received.signal,request.signal);
});
