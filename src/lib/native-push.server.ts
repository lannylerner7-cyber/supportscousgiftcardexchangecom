import {createHash,sign} from "node:crypto";
import {connect} from "node:http2";
export type NativePlatform="android"|"ios";
export function nativePushReady(platform:NativePlatform){
  return platform==="android"?!!process.env["FCM_SERVICE_ACCOUNT_JSON"]:
    ["APNS_KEY_ID","APNS_TEAM_ID","APNS_PRIVATE_KEY"].every(k=>!!process.env[k])&&
    ["sandbox","production"].includes(process.env["APNS_ENVIRONMENT"]??"");
}
function jwt(header:object,payload:object,key:string,algorithm:"RSA-SHA256"|"sha256"){
  const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const input=`${encode(header)}.${encode(payload)}`;
  const signature=sign(algorithm,Buffer.from(input),{key,dsaEncoding:"ieee-p1363"}).toString("base64url");
  return `${input}.${signature}`;
}
let access:{value:string;until:number}|undefined;
async function fcmAccess(){
  const account=JSON.parse(process.env["FCM_SERVICE_ACCOUNT_JSON"]??"{}") as Record<string,string>;
  if(!account["client_email"]||!account["private_key"]||!/^[-a-z0-9]+$/.test(account["project_id"]??""))throw Error("Firebase configuration is incomplete.");
  if(!access||access.until<Date.now()){
    const now=Math.floor(Date.now()/1000);
    const assertion=jwt({alg:"RS256",typ:"JWT"},{iss:account["client_email"],scope:"https://www.googleapis.com/auth/firebase.messaging",
      aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600},account["private_key"],"RSA-SHA256");
    const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
    const body=await response.json() as {access_token?:string};
    if(!response.ok||!body.access_token)throw Error("Firebase authorization failed.");
    access={value:body.access_token,until:Date.now()+50*60000};
  }
  return {project:account["project_id"],access:access.value};
}
export async function sendNativePush(platform:NativePlatform,token:string,eventId:string):Promise<"sent"|"expired">{
  if(!nativePushReady(platform))throw Error("Native push provider is not configured.");
  const title="ScousExchange",body="You have a new update. Open Scous to view it securely.";
  const tag=createHash("sha256").update(eventId).digest("hex").slice(0,32);
  if(platform==="android"){
    const credentials=await fcmAccess();
    const response=await fetch(`https://fcm.googleapis.com/v1/projects/${credentials.project}/messages:send`,{
      method:"POST",signal:AbortSignal.timeout(10000),headers:{"Authorization":`Bearer ${credentials.access}`,"Content-Type":"application/json"},
      body:JSON.stringify({message:{token,notification:{title,body},data:{path:"/app/notifications"},
        android:{collapse_key:tag,ttl:"3600s",notification:{tag,channel_id:"scous_updates"}}}})});
    const result=await response.json() as {error?:{details?:Array<{errorCode?:string}>}};
    if(result.error?.details?.some(d=>d.errorCode==="UNREGISTERED"))return "expired";
    if(!response.ok)throw Error("Firebase delivery failed.");
    return "sent";
  }
  const now=Math.floor(Date.now()/1000);
  const authorization=jwt({alg:"ES256",kid:process.env["APNS_KEY_ID"]},{iss:process.env["APNS_TEAM_ID"],iat:now},
    process.env["APNS_PRIVATE_KEY"]!,"sha256");
  const client=connect(process.env["APNS_ENVIRONMENT"]==="production"?"https://api.push.apple.com":"https://api.sandbox.push.apple.com");
  try{
    return await new Promise<"sent"|"expired">((resolve,reject)=>{
      client.on("error",()=>reject(Error("APNs connection failed.")));
      client.setTimeout(10000,()=>{client.destroy();reject(Error("APNs timeout."));});
      const req=client.request({":method":"POST",":path":`/3/device/${token}`,authorization:`bearer ${authorization}`,
        "apns-topic":"com.scousgiftcardexchange.app","apns-push-type":"alert","apns-priority":"10","apns-collapse-id":tag,
        "apns-expiration":String(now+3600)});
      let status=0;
      req.on("response",headers=>{status=Number(headers[":status"]);});
      req.on("data",()=>{/* Never log provider payloads or tokens. */});
      req.on("error",()=>reject(Error("APNs delivery failed.")));
      req.on("end",()=>status===200?resolve("sent"):status===410?resolve("expired"):reject(Error("APNs delivery rejected.")));
      req.end(JSON.stringify({aps:{alert:{title,body},sound:"default"},"path":"/app/notifications"}));
    });
  }finally{client.close();}
}
