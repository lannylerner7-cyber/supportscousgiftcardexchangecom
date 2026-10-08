import { createHash } from "node:crypto";
import sharp from "sharp";
import { queryOne, execute, nowIso } from "./d1.server";
import { putObject } from "./r2.server";
import { supportActor, threadFor, limit, SupportError } from "./support.server";

export async function uploadSupportImage(threadId:string,attachmentId:string,bytes:ArrayBuffer){
  if(!/^[0-9a-f-]{36}$/i.test(attachmentId))throw new SupportError("Invalid photo identity.");
  const actor=await supportActor();
  const thread=await threadFor(actor,threadId);
  await limit(actor.id,"upload",20);
  // Decode and re-encode: strip metadata, reject decompression bombs/SVG/invalid
  // bytes, and make HEIC input into a safe browser preview where supported.
  let output:Buffer;
  try{
    output=await sharp(Buffer.from(bytes),{limitInputPixels:25_000_000,animated:false})
      .rotate().resize(1800,1800,{fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
  }catch{throw new SupportError("This photo could not be decoded. Choose a valid JPG, PNG or WEBP photo.",400);}
  const digest=createHash("sha256").update(output).digest("hex");
  const path=`${thread["user_id"]}/chat/${threadId}/${attachmentId}.webp`;
  await execute(`INSERT INTO support_attachments(id,thread_id,uploader_id,path,digest,created_at)
    SELECT ?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM support_attachments WHERE uploader_id=? AND created_at>?)<100
      AND (SELECT COUNT(*) FROM support_attachments WHERE uploader_id=? AND message_id IS NULL AND ready>=0)<20
    ON CONFLICT(id) DO NOTHING`,
    [attachmentId,threadId,actor.id,path,digest,nowIso(),actor.id,new Date(Date.now()-86400000).toISOString(),actor.id]);
  const reserved=await queryOne<{thread_id:string;uploader_id:string;digest:string;ready:number}>(
    "SELECT thread_id,uploader_id,digest,ready FROM support_attachments WHERE id=?",[attachmentId]);
  if(!reserved)throw new SupportError("Photo quota reached. Contact support before uploading more.",429);
  if(reserved.thread_id!==threadId||reserved.uploader_id!==actor.id||reserved.digest!==digest)
    throw new SupportError("This photo retry differs from the original.",409);
  if(reserved.ready<0)throw new SupportError("This unused upload expired. Choose the photo again.",410);
  if(!reserved.ready){
    // Renew the reservation before network I/O. Cleanup can only tombstone
    // old reservations; it cannot race a revived upload back into existence.
    const renewed=await execute("UPDATE support_attachments SET created_at=? WHERE id=? AND ready=0",[nowIso(),attachmentId]);
    if(!renewed.changes)throw new SupportError("This upload changed. Please retry.",409);
    await putObject(path,output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer,"image/webp");
    await execute("UPDATE support_attachments SET ready=1 WHERE id=? AND ready=0",[attachmentId]);
  }
  return {ok:true,path};
}
