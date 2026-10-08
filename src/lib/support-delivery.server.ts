import {query,queryOne,execute,nowIso} from "./d1.server";
import {sendEmail,supportAlertEmail} from "./email.server";
import {SITE_ORIGIN} from "./public-site";
import {draining} from "./observability.server";

export async function deliverSupportMail(){
  const jobs=await query<{message_id:string;thread_id:string;attempts:number}>(`
    SELECT message_id,thread_id,attempts FROM support_mail WHERE sent_at IS NULL AND attempts<5
    AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_at LIMIT 10`,[nowIso(),nowIso()]);
  for(const job of jobs){
    if(draining)break;
    const token=crypto.randomUUID();
    const claimed=await queryOne(`UPDATE support_mail SET lease_token=?,lease_until=?,attempts=attempts+1
      WHERE message_id=? AND sent_at IS NULL AND attempts<5 AND next_at<=?
      AND (lease_until IS NULL OR lease_until<?) RETURNING message_id`,
      [token,new Date(Date.now()+120000).toISOString(),job.message_id,nowIso(),nowIso()]);
    if(!claimed)continue;
    let reason="delivery_failed";
    try{
      const settings=await queryOne<{alert_emails:string}>("SELECT alert_emails FROM app_settings WHERE id=1");
      const parsed=JSON.parse(settings?.alert_emails??"[]");
      const to=Array.isArray(parsed)?parsed.filter((v):v is string=>typeof v==="string"&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)).slice(0,10):[];
      if(!to.length){reason="no_recipients";throw Error();}
      const mail=supportAlertEmail(`${SITE_ORIGIN}/ScousGiftCardExchange/admin/messages?thread=${encodeURIComponent(job.thread_id)}`);
      const result=await sendEmail({to,...mail});
      if(!result.sent)throw Error();
      await execute("UPDATE support_mail SET sent_at=?,lease_until=NULL,last_error=NULL WHERE message_id=? AND lease_token=?",
        [nowIso(),job.message_id,token]);
    }catch{
      // Provider exceptions can contain addresses; retain only a safe category.
      console.error(`[support-mail] ${reason}; ${job.attempts>=4?"exhausted":"retry queued"}`);
      await execute(`UPDATE support_mail SET lease_until=NULL,next_at=?,last_error=? WHERE message_id=? AND lease_token=?`,
        [new Date(Date.now()+60000*2**job.attempts).toISOString(),reason,job.message_id,token]);
    }
  }
}

/** Tombstone before deletion so a concurrent send cannot link a removed file.
 * Never delete committed images or ambiguous/recent uploads. Retain the identity
 * tombstone so a delayed retry fails explicitly rather than creating a ghost.
 */
export async function cleanSupportOrphans(){
  const rows=await query<{id:string;path:string}>(`UPDATE support_attachments SET ready=-1
    WHERE id IN(SELECT id FROM support_attachments WHERE message_id IS NULL AND created_at<?
      AND ready>=0 LIMIT 10) RETURNING id,path`,[new Date(Date.now()-30*86400000).toISOString()]);
  const {deleteObject}=await import("./r2.server");
  for(const row of rows){
    try{await deleteObject(row.path,true,AbortSignal.timeout(15000));await execute("UPDATE support_attachments SET ready=-2 WHERE id=? AND ready=-1",[row.id]);}
    catch{console.error("[support-upload] orphan deletion failed; retained tombstone");}
  }
  // A prior deletion may have failed after tombstoning. Retry boundedly.
  const retry=await query<{id:string;path:string}>("SELECT id,path FROM support_attachments WHERE ready=-1 LIMIT 10");
  for(const row of retry){
    try{await deleteObject(row.path,true,AbortSignal.timeout(15000));await execute("UPDATE support_attachments SET ready=-2 WHERE id=? AND ready=-1",[row.id]);}
    catch{console.error("[support-upload] orphan deletion retry failed");}
  }
}
