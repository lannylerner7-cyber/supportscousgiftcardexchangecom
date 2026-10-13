import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

async function failure(error:unknown,diagnostics?:{action:unknown;startedAt:number}){
  const {SupportError}=await import("@/lib/support.server");
  const status=error instanceof SupportError?error.status:error instanceof z.ZodError?400:500;
  if(status===500)console.error("[support] request failed; private details redacted");
  if(diagnostics?.action==="open"){
    console.info("[support] open failed",{status,latencyMs:Math.round(performance.now()-diagnostics.startedAt)});
  }
  const message=error instanceof SupportError
    ?error.message
    :status===400
      ?"Invalid chat request."
      :diagnostics?.action==="open"
        ?"Support chat is temporarily unavailable. Please retry shortly."
        :"The support request could not be completed. Please retry.";
  return new Response(message,{
    status,headers:{"Cache-Control":"private, no-store"},
  });
}
export const Route=createFileRoute("/api/support")({
  server:{handlers:{
    POST:async({request})=>{
      const startedAt=performance.now();
      let action:unknown;
      try{
        // Reject cross-site mutations even though embedded preview uses SameSite=None.
        if(request.headers.get("sec-fetch-site")==="cross-site")return new Response("Not allowed",{status:403});
        if(!request.headers.get("content-type")?.startsWith("application/json"))return new Response("JSON required",{status:415});
        const {boundedBody}=await import("@/lib/bounded-body.server");
        const bytes=await boundedBody(request,20000);
        if(!bytes)return new Response("Request too large",{status:413});
        const text=new TextDecoder().decode(bytes);
        const input=JSON.parse(text);
        if(input&&typeof input==="object")action=(input as {action?:unknown}).action;
        const {supportAction}=await import("@/lib/support.server");
        const result=await supportAction(input,request.signal);
        if(action==="open"){
          console.info("[support] open complete",{status:200,latencyMs:Math.round(performance.now()-startedAt)});
        }
        return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
      }catch(e){
        if(request.signal.aborted)return new Response(null,{status:499});
        return failure(e,{action,startedAt});
      }
    },
    GET:async({request})=>{
      try{
        if(request.headers.get("sec-fetch-site")==="cross-site")return new Response("Not allowed",{status:403});
        const {supportActor}=await import("@/lib/support.server");
        const {supportHub}=await import("@/lib/support-stream.server");
        const url=new URL(request.url);
        const after=Number(request.headers.get("last-event-id")||url.searchParams.get("after")||0);
        if(!Number.isSafeInteger(after)||after<0)throw new z.ZodError([]);
        return await supportHub.connect(await supportActor(),url.searchParams.get("threadId")??"",after,request.signal);
      }catch(e){return failure(e);}
    },
  }},
});
