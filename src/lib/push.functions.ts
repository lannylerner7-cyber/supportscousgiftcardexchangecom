import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { validPushEndpoint } from "./push-policy";
const endpoint=z.string().max(2048).refine(validPushEndpoint,"Unsupported push service.");
export const pushStatus=createServerFn({method:"GET"}).handler(async()=>{
  const {requireUserId}=await import("./guard.server");
  const {queryOne}=await import("./d1.server");
  const id=await requireUserId();
  const p=await queryOne<{push_enabled:number}>("SELECT push_enabled FROM profiles WHERE id=?",[id]);
  const {pushKeys}=await import("./push.server");
  return {enabled:!!p?.push_enabled,publicKey:(await pushKeys(new URL(getRequest().url).origin)).publicKey};
});
export const savePush=createServerFn({method:"POST"}).inputValidator((data:unknown)=>z.object({
  endpoint,keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}$/)}),
}).parse(data)).handler(async({data})=>{
  const {requireUserId,sha256Hex}=await import("./guard.server");
  const {execute,queryOne,nowIso}=await import("./d1.server");
  const id=await requireUserId(),origin=new URL(getRequest().url).origin;
  const count=await queryOne<{c:number}>("SELECT count(*) c FROM device_push WHERE user_id=?",[id]);
  const existing=await queryOne<{user_id:string}>("SELECT user_id FROM device_push WHERE endpoint=?",[data.endpoint]);
  if(existing && existing.user_id!==id) throw new Error("Remove this browser's existing push subscription, then enable alerts again.");
  if(!existing && (count?.c??0)>=10)throw new Error("You can enable up to ten devices. Disable an old device first.");
  await execute(`INSERT INTO device_push(id,user_id,origin,endpoint,p256dh,auth,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE id=? AND deleted_at IS NULL)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth
    WHERE device_push.user_id=excluded.user_id`,
    [await sha256Hex(data.endpoint),id,origin,data.endpoint,data.keys.p256dh,data.keys.auth,nowIso(),id]);
  await execute("UPDATE profiles SET push_enabled=1 WHERE id=? AND deleted_at IS NULL",[id]);
  return {ok:true};
});
export const removePush=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({endpoint:endpoint.optional(),all:z.boolean().optional()}).parse(d))
.handler(async({data})=>{
  const {requireUserId}=await import("./guard.server");const {transaction}=await import("./d1.server");
  const id=await requireUserId();
  if(data.all)await transaction([
    {sql:"DELETE FROM native_push_devices WHERE user_id=?",params:[id]},
    {sql:"DELETE FROM device_push WHERE user_id=?",params:[id]},
    {sql:"UPDATE profiles SET push_enabled=0 WHERE id=?",params:[id]},
  ]);
  else if(data.endpoint)await transaction([{sql:"DELETE FROM device_push WHERE user_id=? AND endpoint=?",params:[id,data.endpoint]}]);
  return {ok:true};
});
export const thisDeviceEnabled=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({endpoint}).parse(d))
.handler(async({data})=>{
  const {requireUserId}=await import("./guard.server");const {queryOne}=await import("./d1.server");
  const id=await requireUserId();
  return {enabled:!!await queryOne(`SELECT d.id FROM device_push d JOIN profiles p ON p.id=d.user_id
    WHERE d.endpoint=? AND d.user_id=? AND p.push_enabled=1 AND p.deleted_at IS NULL`,[data.endpoint,id])};
});
