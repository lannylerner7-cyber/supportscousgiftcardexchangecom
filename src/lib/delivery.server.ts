import { query, queryOne, execute, nowIso } from "./d1.server";
import { PUSH_MESSAGE, validPushEndpoint } from "./push-policy";
import { SITE_ORIGIN } from "./public-site";
import { beginDrain, draining, correlated, measure } from "./observability.server";

let running=false;
const origins=new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;
// Let the hosting HTTP runtime handle exit; stop new claims during its drain.
process.once("SIGTERM", () => { beginDrain(); if(timer)clearInterval(timer); });
export function startDelivery(origin:string) {
  if(draining)return;
  // Only process subscriptions registered through this serving origin.
  if(origins.size<4)origins.add(origin);
  if(timer)return;
  timer=setInterval(()=>void correlated(async()=>{
    const started=performance.now();let ok=false;
    try{await deliver();ok=true;}finally{measure("delivery",performance.now()-started,ok);}
  }).catch(()=>console.error("[delivery] background processing failed; retained for retry")),60_000);
  timer.unref?.();
}
export async function deliver() {
  if(running || draining)return;
  running=true;
  try {
    for(const origin of origins) {
      // Insert only committed, new, unread notifications for active opted-in devices.
      await execute(`INSERT INTO push_deliveries(id,device_id,notification_id,next_at)
        SELECT d.id||':'||n.id,d.id,n.id,? FROM device_push d
        JOIN notifications n ON n.user_id=d.user_id JOIN profiles p ON p.id=d.user_id
        WHERE d.origin=? AND p.deleted_at IS NULL AND p.push_enabled=1 AND n.read_at IS NULL
        AND n.created_at>=d.created_at AND n.created_at>?
        ON CONFLICT(device_id,notification_id) DO NOTHING`,
        [nowIso(),origin,new Date(Date.now()-86400000).toISOString()]);
      const jobs=await query<{id:string;device_id:string;endpoint:string;p256dh:string;auth:string;attempts:number}>(`
        SELECT j.id,j.device_id,j.attempts,d.endpoint,d.p256dh,d.auth
        FROM push_deliveries j JOIN device_push d ON d.id=j.device_id JOIN profiles p ON p.id=d.user_id
        JOIN notifications n ON n.id=j.notification_id
        WHERE d.origin=? AND j.sent_at IS NULL AND j.terminal=0 AND j.attempts<5 AND j.next_at<=?
        AND (j.lease_until IS NULL OR j.lease_until<?) AND p.deleted_at IS NULL AND p.push_enabled=1
        AND n.read_at IS NULL ORDER BY j.next_at LIMIT 20`,[origin,nowIso(),nowIso()]);
      for(const j of jobs) {
        if(draining)break;
        const token=crypto.randomUUID(),until=new Date(Date.now()+120000).toISOString();
        const claimed=await queryOne(`UPDATE push_deliveries SET lease_token=?,lease_until=?,attempts=attempts+1
          WHERE id=? AND sent_at IS NULL AND terminal=0 AND attempts<5
          AND (lease_until IS NULL OR lease_until<?) RETURNING id`,[token,until,j.id,nowIso()]);
        if(!claimed)continue;
        try {
          if(!validPushEndpoint(j.endpoint))throw new Error("Invalid push endpoint");
          const {webPush,pushKeys}=await import("./push.server");
          const keys=await pushKeys(origin);
          // Recheck consent and active membership immediately before network delivery.
          if(!await queryOne(`SELECT d.id FROM device_push d JOIN profiles p ON p.id=d.user_id
            WHERE d.id=? AND p.deleted_at IS NULL AND p.push_enabled=1`,[j.device_id])){
            await execute("UPDATE push_deliveries SET terminal=1,lease_until=NULL WHERE id=? AND lease_token=?",[j.id,token]);continue;
          }
          await webPush.sendNotification({endpoint:j.endpoint,keys:{p256dh:j.p256dh,auth:j.auth}},
            JSON.stringify({...PUSH_MESSAGE,tag:j.id}),{TTL:3600,timeout:10000,
              vapidDetails:{subject:"mailto:support@scousgiftcardexchange.com",...keys}});
          await execute("UPDATE push_deliveries SET sent_at=?,lease_until=NULL WHERE id=? AND lease_token=?",[nowIso(),j.id,token]);
        } catch(e) {
          measure("delivery",0,false);
          const status=(e as {statusCode?:number}).statusCode;
          if(status===404 || status===410)await execute("DELETE FROM device_push WHERE id=?",[j.device_id]);
          else await execute(`UPDATE push_deliveries SET next_at=?,lease_until=NULL,terminal=? WHERE id=? AND lease_token=?`,
            [new Date(Date.now()+Math.min(3600000,60000*2**j.attempts)).toISOString(),
              status===400 || status===413 || j.attempts>=4 ? 1:0,j.id,token]);
        }
      }
    }
    if(origins.has(SITE_ORIGIN)){
      const {deliverNative}=await import("./native-delivery.server");
      await deliverNative();
    }
    // Closure mail is only dispatched by the production-origin process.
    // Preview fixture mail can be exercised explicitly by the test harness.
    if(origins.has(SITE_ORIGIN)) {
      await deliverClosureMail();
      const {deliverSupportMail,cleanSupportOrphans}=await import("./support-delivery.server");
      await deliverSupportMail();
      await cleanSupportOrphans();
    }
  } finally {running=false;}
}
export function closureMail(kind:string) {
  const text=kind==="closed"
    ? "We’re sad to see you go. Your Scous account is now inactive. Your records have been retained for possible reactivation; this is not permanent data deletion. Any still-locked promotional credit you explicitly waived will not be restored. To return, request reactivation below."
    : kind==="reactivated"
      ? "Your reactivation request has been approved. Sign in with your password. Device alerts remain off until you enable them again."
      : "We received your deactivation request. Your available balance must be withdrawn to your linked bank using the usual fee and minimum. Pending activity must settle before admin approval. This message does not confirm a bank payment. Contact support if you cannot settle your balance.";
  const link=SITE_ORIGIN+(kind==="closed"?"/account-help":kind==="reactivated"?"/login":"/app/settings");
  const label=kind==="closed"?"Request reactivation":kind==="reactivated"?"Sign in":"View request";
  return {subject:kind==="closed"?"Your Scous account is inactive":kind==="reactivated"?"Welcome back to Scous":"Your Scous deactivation request",
    text:`${text}\n\n${label}: ${link}\nSupport: support@scousgiftcardexchange.com`,
    html:`<div style="font:16px Arial;line-height:1.6;background:#0d1220;color:#fff;padding:32px"><h1>ScousExchange</h1><p>${text}</p><p><a style="background:#e4c551;color:#111;padding:14px 22px;border-radius:24px;display:inline-block" href="${link}">${label}</a></p><p>Support: support@scousgiftcardexchange.com</p></div>`};
}
export async function deliverClosureMail() {
  const jobs=await query<{id:string;email:string;kind:string;attempts:number}>(`
    SELECT j.id,u.email,j.kind,j.attempts FROM closure_mail j JOIN users u ON u.id=j.user_id
    WHERE j.sent_at IS NULL AND j.attempts<5 AND j.next_at<=? AND (j.lease_until IS NULL OR j.lease_until<?)
    ORDER BY j.next_at LIMIT 10`,[nowIso(),nowIso()]);
  for(const j of jobs) {
    if(draining)break;
    const token=crypto.randomUUID();
    if(!await queryOne(`UPDATE closure_mail SET lease_until=?,lease_token=?,attempts=attempts+1
      WHERE id=? AND sent_at IS NULL AND attempts<5 AND (lease_until IS NULL OR lease_until<?) RETURNING id`,
      [new Date(Date.now()+120000).toISOString(),token,j.id,nowIso()]))continue;
    try {
      const {sendEmail}=await import("./email.server");
      const result=await sendEmail({to:j.email,...closureMail(j.kind)});
      if(!result.sent)throw new Error("Email not accepted");
      await execute("UPDATE closure_mail SET sent_at=?,lease_until=NULL WHERE id=? AND lease_token=?",[nowIso(),j.id,token]);
    } catch {
      measure("delivery",0,false);
      await execute("UPDATE closure_mail SET next_at=?,lease_until=NULL WHERE id=? AND lease_token=?",
        [new Date(Date.now()+60000*2**j.attempts).toISOString(),j.id,token]);
    }
  }
}
