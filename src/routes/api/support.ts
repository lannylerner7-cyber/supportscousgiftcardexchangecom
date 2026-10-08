import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

async function failure(error:unknown){
  const {SupportError}=await import("@/lib/support.server");
  const status=error instanceof SupportError?error.status:error instanceof z.ZodError?400:500;
  if(status===500)console.error("[support] request failed; private details redacted");
  return new Response(error instanceof SupportError?error.message:status===400?"Invalid chat request.":"Chat is unavailable. Please sign in again or retry.",{
    status,headers:{"Cache-Control":"private, no-store"},
  });
}
export const Route=createFileRoute("/api/support")({
  server:{handlers:{
    POST:async({request})=>{
      try{
        // Reject cross-site mutations even though embedded preview uses SameSite=None.
        if(request.headers.get("sec-fetch-site")==="cross-site")return new Response("Not allowed",{status:403});
        if(!request.headers.get("content-type")?.startsWith("application/json"))return new Response("JSON required",{status:415});
        const {boundedBody}=await import("@/lib/bounded-body.server");
        const bytes=await boundedBody(request,20000);
        if(!bytes)return new Response("Request too large",{status:413});
        const text=new TextDecoder().decode(bytes);
        const {supportAction}=await import("@/lib/support.server");
        return Response.json(await supportAction(JSON.parse(text)),{headers:{"Cache-Control":"private, no-store"}});
      }catch(e){return failure(e);}
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
