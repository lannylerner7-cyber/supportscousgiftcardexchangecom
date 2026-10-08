import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { closureBlock } from "./closure-policy";

export const closureStatus=createServerFn({method:"GET"}).handler(async()=>{
  const {requireUserId}=await import("./guard.server");const {queryOne}=await import("./d1.server");
  const id=await requireUserId();
  return queryOne<{status:string;waive_locked:number;note:string|null}>("SELECT status,waive_locked,note FROM account_closures WHERE user_id=?",[id]);
});
export const cancelClosure=createServerFn({method:"POST"}).handler(async()=>{
  const {requireUserId}=await import("./guard.server");const {queryOne}=await import("./d1.server");
  const id=await requireUserId();
  if(!await queryOne("UPDATE account_closures SET status='cancelled' WHERE user_id=? AND status='requested' RETURNING id",[id]))
    throw new Error("The request is no longer awaiting review.");
  return {ok:true};
});
export const requestClosure=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({
  password:z.string().min(1).max(200),waiveLocked:z.boolean(),confirmation:z.literal("DEACTIVATE"),
}).parse(d)).handler(async({data})=>{
  const {requireUserId,verifyPassword}=await import("./guard.server");
  const {queryOne,transaction,nowIso,newId}=await import("./d1.server");
  const id=await requireUserId();
  const user=await queryOne<{password_hash:string}>("SELECT password_hash FROM users WHERE id=?",[id]);
  if(!user || !await verifyPassword(data.password,user.password_hash))throw new Error("Your password is incorrect.");
  const old=await queryOne<{status:string}>("SELECT status FROM account_closures WHERE user_id=?",[id]);
  if(old?.status==="requested")return {ok:true};
  const requestId=newId(),now=nowIso();
  await transaction([
    {sql:`INSERT INTO account_closures(user_id,id,status,waive_locked,requested_at)
      VALUES(?,?,'requested',?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,status='requested',
      waive_locked=excluded.waive_locked,requested_at=excluded.requested_at,note=NULL,reviewed_at=NULL
      WHERE account_closures.status IN ('reactivated','cancelled')`,params:[id,requestId,data.waiveLocked,now]},
    {sql:`INSERT INTO notifications(id,user_id,title,body,type,link,created_at)
      SELECT ?||'-member',user_id,'Deactivation requested','Withdraw your available balance and settle pending activity. Our team will review your request.','info','/app/settings',?
      FROM account_closures WHERE id=? ON CONFLICT(id) DO NOTHING`,params:[requestId,now,requestId]},
    {sql:`INSERT INTO notifications(id,user_id,title,body,type,link,created_at)
      SELECT ?||'-admin-'||r.user_id,r.user_id,'Account closure review','A member requested deactivation. Review settlement before closing.','info','/ScousGiftCardExchange/admin/closures',?
      FROM user_roles r WHERE r.role='admin' AND EXISTS(SELECT 1 FROM account_closures WHERE id=?)
      ON CONFLICT(id) DO NOTHING`,params:[requestId,now,requestId]},
    {sql:`INSERT INTO closure_mail(id,user_id,kind,next_at) SELECT ?||'-requested',user_id,'requested',?
      FROM account_closures WHERE id=? ON CONFLICT(id) DO NOTHING`,params:[requestId,now,requestId]},
  ]);
  return {ok:true};
});
export const listClosures=createServerFn({method:"GET"}).handler(async()=>{
  const {requireAdminId}=await import("./guard.server");await requireAdminId();
  const {query}=await import("./d1.server");
  return query<{user_id:string;id:string;status:string;full_name:string;email:string;balance_naira:number;held_naira:number;locked_naira:number;waive_locked:number;frozen_at:string|null;pending:number;note:string|null;mail_status:string|null}>(`
    SELECT c.*,p.full_name,p.email,p.frozen_at,w.balance_naira,w.held_naira,w.locked_naira,
    (SELECT CASE WHEN m.sent_at IS NOT NULL THEN 'Accepted by email provider' WHEN m.attempts>=5 THEN 'Failed after five attempts — support follow-up required' ELSE 'Queued for delivery' END
      FROM closure_mail m WHERE m.user_id=c.user_id ORDER BY m.next_at DESC LIMIT 1) mail_status,
    ((SELECT count(*) FROM trades WHERE user_id=c.user_id AND status='pending')+
    (SELECT count(*) FROM withdrawals WHERE user_id=c.user_id AND status IN ('requested','approved'))) pending
    FROM account_closures c JOIN profiles p ON p.id=c.user_id JOIN wallets w ON w.user_id=c.user_id
    ORDER BY c.requested_at DESC LIMIT 200`);
});
export const reviewClosure=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({
  id:z.string().uuid(),action:z.enum(["close","reactivate","note"]),note:z.string().trim().min(5).max(1000),
}).parse(d)).handler(async({data})=>{
  const {requireAdminId,sha256Hex}=await import("./guard.server");const actor=await requireAdminId();
  const {queryOne,transaction,nowIso,newId}=await import("./d1.server");
  const c=await queryOne<{user_id:string;status:string;waive_locked:number}>("SELECT user_id,status,waive_locked FROM account_closures WHERE id=?",[data.id]);
  if(!c)throw new Error("Request not found.");
  const now=nowIso(),id=c.user_id;
  if(data.action==="note"){
    const notificationId=await sha256Hex("support:"+data.id+":"+data.note);
    await transaction([
      {sql:"UPDATE account_closures SET note=? WHERE id=?",params:[data.note,data.id]},
      {sql:"INSERT INTO notifications(id,user_id,title,body,type,link,created_at) VALUES(?,?,'Support update',?,'info','/app/settings',?) ON CONFLICT(id) DO NOTHING",params:[notificationId,id,data.note,now]},
    ]);return {ok:true};
  }
  if(data.action==="reactivate"){
    if(c.status!=="reactivation_requested")throw new Error("The member must verify a reactivation request first.");
    await transaction([
      {sql:"UPDATE account_closures SET status='reactivated',note=?,reviewed_at=?,reviewer_id=? WHERE id=? AND status='reactivation_requested'",params:[data.note,now,actor,data.id]},
      {sql:"UPDATE profiles SET deleted_at=NULL,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM account_closures WHERE id=? AND status='reactivated')",params:[now,id,data.id]},
      {sql:"DELETE FROM sessions WHERE user_id=?",params:[id]},
      {sql:"INSERT INTO closure_mail(id,user_id,kind,next_at) VALUES(?,?,'reactivated',?) ON CONFLICT(id) DO NOTHING",params:[data.id+"-reactivated",id,now]},
    ]);return {ok:true};
  }
  if(c.status!=="requested")throw new Error("This request is not awaiting closure.");
  const w=await queryOne<{id:string;balance_naira:number;held_naira:number;locked_naira:number}>("SELECT * FROM wallets WHERE user_id=?",[id]);
  const p=await queryOne<{frozen_at:string|null}>("SELECT frozen_at FROM profiles WHERE id=?",[id]);
  const pending=await queryOne<{c:number}>(`SELECT ((SELECT count(*) FROM trades WHERE user_id=? AND status='pending')+
    (SELECT count(*) FROM withdrawals WHERE user_id=? AND status IN ('requested','approved'))) c`,[id,id]);
  if(!w)throw new Error("Wallet not found.");
  const reason=closureBlock(w.balance_naira,w.held_naira,w.locked_naira,pending?.c??0,!!p?.frozen_at,!!c.waive_locked);
  if(reason)throw new Error(reason);
  // All eligibility predicates are rechecked in the same atomic write as the debit.
  const eligible=`EXISTS(SELECT 1 FROM account_closures c JOIN profiles p ON p.id=c.user_id
    JOIN wallets w ON w.user_id=p.id WHERE c.id=? AND c.status='requested' AND p.deleted_at IS NULL
    AND p.frozen_at IS NULL AND w.held_naira=0 AND w.balance_naira=w.locked_naira AND w.locked_naira>=0
    AND (w.locked_naira=0 OR c.waive_locked=1)
    AND NOT EXISTS(SELECT 1 FROM trades WHERE user_id=p.id AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM withdrawals WHERE user_id=p.id AND status IN ('requested','approved'))
    AND (NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=p.id AND role='admin')
      OR EXISTS(SELECT 1 FROM user_roles r JOIN profiles other ON other.id=r.user_id
        WHERE r.role='admin' AND r.user_id<>p.id AND other.deleted_at IS NULL)))`;
  const marker=data.id+"-forfeit";
  await transaction([
    {sql:`INSERT INTO wallet_transactions(id,wallet_id,user_id,type,amount,balance_after,reference_type,reference_id,note,created_at)
      SELECT ?,id,user_id,'debit',locked_naira,0,'closure_promo_waiver',?,'Explicit waiver of still-locked promotional credit',?
      FROM wallets WHERE user_id=? AND ${eligible} ON CONFLICT(id) DO NOTHING`,params:[marker,data.id,now,id,data.id]},
    {sql:`UPDATE wallets SET balance_naira=0,locked_naira=0,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE id=?)`,params:[now,id,marker]},
    {sql:`UPDATE profiles SET deleted_at=?,push_enabled=0,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE id=?)`,params:[now,now,id,marker]},
    {sql:`UPDATE account_closures SET status='closed',note=?,reviewed_at=?,reviewer_id=? WHERE id=? AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND deleted_at IS NOT NULL)`,params:[data.note,now,actor,data.id,id]},
    ...["sessions","device_push"].map(table=>({sql:`DELETE FROM ${table} WHERE user_id=? AND EXISTS(SELECT 1 FROM account_closures WHERE id=? AND status='closed')`,params:[id,data.id]})),
    {sql:`UPDATE otp_codes SET consumed_at=? WHERE email=(SELECT email FROM users WHERE id=?) AND EXISTS(SELECT 1 FROM account_closures WHERE id=? AND status='closed')`,params:[now,id,data.id]},
    {sql:`INSERT INTO closure_mail(id,user_id,kind,next_at) SELECT ?||'-closed',user_id,'closed',? FROM account_closures WHERE id=? AND status='closed' ON CONFLICT(id) DO NOTHING`,params:[data.id,now,data.id]},
    {sql:`INSERT INTO admin_audit_log(id,actor_id,action,target_type,target_id,created_at)
      SELECT ?,?,'account.deactivate','user',?,? WHERE EXISTS(SELECT 1 FROM account_closures WHERE id=? AND status='closed')`,
      params:[newId(),actor,id,now,data.id]},
  ]);
  const result=await queryOne<{status:string}>("SELECT status FROM account_closures WHERE id=?",[data.id]);
  if(result?.status!=="closed")throw new Error("Closure blocked: settlement changed or this is the last active administrator.");
  return {ok:true};
});
