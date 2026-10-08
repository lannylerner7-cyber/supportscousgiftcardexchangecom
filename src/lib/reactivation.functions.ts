import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const sendReactivationCode=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({email:z.string().email().max(200)}).parse(d))
.handler(async({data})=>{
  const {queryOne,transaction,newId,nowIso}=await import("./d1.server");
  const {sha256Hex}=await import("./guard.server");
  const {sixDigitCode}=await import("./otp-policy");
  const email=data.email.trim().toLowerCase();
  if(!await queryOne("SELECT id FROM profiles WHERE email=? AND deleted_at IS NOT NULL",[email]))return {ok:true};
  const id=newId(),now=nowIso(),code=sixDigitCode();
  // Use a domain-separated hash in the existing reset slot: this code cannot
  // reset a password or open a session through the ordinary OTP endpoints.
  const rows=await transaction([
    {sql:`INSERT INTO otp_codes(id,email,purpose,code_hash,expires_at,created_at)
      SELECT ?,?,'reset',?,?,? WHERE (SELECT count(*) FROM otp_codes WHERE email=? AND purpose='reset' AND created_at>?)<5
      AND NOT EXISTS(SELECT 1 FROM otp_codes WHERE email=? AND purpose='reset' AND created_at>?) RETURNING id`,
      params:[id,email,await sha256Hex(`${email}:reactivation:${code}`),new Date(Date.now()+300000).toISOString(),now,email,new Date(Date.now()-3600000).toISOString(),email,new Date(Date.now()-60000).toISOString()]},
    {sql:`UPDATE otp_codes SET consumed_at=? WHERE email=? AND purpose='reset' AND id<>? AND consumed_at IS NULL
      AND EXISTS(SELECT 1 FROM otp_codes WHERE id=?)`,params:[now,email,id,id]},
  ]);
  if(rows[0]?.length){
    const {sendEmail}=await import("./email.server");
    const result=await sendEmail({to:email,subject:"Verify your Scous reactivation request",
      text:`Your reactivation verification code is ${code}. It expires in five minutes. Admin approval is still required. Ignore this email if you did not request it.`,
      html:`<h1>Scous account reactivation</h1><p>Your verification code is <strong>${code}</strong>.</p><p>It expires in five minutes. Admin approval is still required. Ignore this email if you did not request it.</p>`});
    if(!result.sent)throw new Error("Verification email could not be sent. Please retry later or contact support.");
  }
  return {ok:true};
});
export const requestReactivation=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({
  email:z.string().email().max(200),code:z.string().regex(/^\d{6}$/),
}).parse(d)).handler(async({data})=>{
  const {queryOne,execute,transaction,newId,nowIso}=await import("./d1.server");
  const {sha256Hex,timingSafeEqual}=await import("./guard.server");
  const email=data.email.trim().toLowerCase();
  const otp=await queryOne<{id:string;code_hash:string;attempts:number}>(`SELECT id,code_hash,attempts FROM otp_codes
    WHERE email=? AND purpose='reset' AND consumed_at IS NULL AND expires_at>? AND attempts<3 ORDER BY created_at DESC LIMIT 1`,[email,nowIso()]);
  if(!otp)throw new Error("Invalid or expired code.");
  if(!timingSafeEqual(otp.code_hash,await sha256Hex(`${email}:reactivation:${data.code}`))){
    await execute("UPDATE otp_codes SET attempts=attempts+1 WHERE id=?",[otp.id]);
    throw new Error("Invalid or expired code.");
  }
  const now=nowIso(),notificationId=newId();
  await transaction([
    {sql:`UPDATE account_closures SET status='reactivation_requested',requested_at=?
      WHERE user_id=(SELECT p.id FROM profiles p WHERE p.email=? AND p.deleted_at IS NOT NULL)
      AND status='closed' AND EXISTS(SELECT 1 FROM otp_codes WHERE id=? AND consumed_at IS NULL AND attempts<3 AND expires_at>?)`,params:[now,email,otp.id,now]},
    {sql:`INSERT INTO notifications(id,user_id,title,body,type,link,created_at)
      SELECT ?||r.user_id,r.user_id,'Reactivation requested','A member verified their email and requested reactivation.','info','/ScousGiftCardExchange/admin/closures',?
      FROM user_roles r WHERE r.role='admin' AND EXISTS(SELECT 1 FROM account_closures c JOIN profiles p ON p.id=c.user_id
        WHERE p.email=? AND c.status='reactivation_requested' AND c.requested_at=?)
      AND EXISTS(SELECT 1 FROM otp_codes WHERE id=? AND consumed_at IS NULL)`,params:[notificationId,now,email,now,otp.id]},
    {sql:"UPDATE otp_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL",params:[now,otp.id]},
  ]);
  return {ok:true}; // Do not disclose whether an email owns a closed account.
});
