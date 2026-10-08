import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
export const nativePushStatus=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({platform:z.enum(["android","ios"])}).parse(d))
.handler(async({data})=>{
  const {requireUserId,readSession}=await import("./guard.server");const {queryOne}=await import("./d1.server");
  const {nativePushReady}=await import("./native-push.server");const user=await requireUserId(),session=await readSession();
  return {configured:nativePushReady(data.platform),enabled:!!await queryOne(`SELECT d.id FROM native_push_devices d JOIN profiles p ON p.id=d.user_id
    WHERE d.user_id=? AND d.session_id=? AND d.platform=? AND p.push_enabled=1`,[user,session.data.sessionId!,data.platform])};
});
export const saveNativePush=createServerFn({method:"POST"}).inputValidator((d:unknown)=>z.object({platform:z.enum(["android","ios"]),token:z.string().min(20).max(4096)}).parse(d))
.handler(async({data})=>{
  if(!(data.platform==="ios"?/^[a-f0-9]{64}$/i:/^[A-Za-z0-9:_-]+$/).test(data.token))throw Error("Invalid device token.");
  const {requireUserId,readSession,sha256Hex}=await import("./guard.server");const {queryOne,transaction,nowIso}=await import("./d1.server");
  const {nativePushReady}=await import("./native-push.server");
  const user=await requireUserId(),session=(await readSession()).data.sessionId!;
  if(!nativePushReady(data.platform))throw Error("Native push is not configured yet. In-app alerts remain available.");
  const id=await sha256Hex(data.platform+":"+data.token);
  const old=await queryOne<{user_id:string}>("SELECT user_id FROM native_push_devices WHERE id=?",[id]);
  if(old&&old.user_id!==user)throw Error("Disable notifications in the previous account before registering this device.");
  if(!old&&(await queryOne<{n:number}>("SELECT count(*) n FROM native_push_devices WHERE user_id=?",[user]))!.n>=10)
    throw Error("Disable unused devices before adding another.");
  // Registration is scoped to a revocable server session, never merely a user ID.
  await transaction([
    {sql:`INSERT INTO native_push_devices(id,user_id,session_id,platform,token,created_at)
      SELECT ?,p.id,s.id,?,?,? FROM profiles p JOIN sessions s ON s.user_id=p.id
      WHERE p.id=? AND p.deleted_at IS NULL AND s.id=? AND s.expires_at>?
      AND ((SELECT count(*) FROM native_push_devices WHERE user_id=p.id)<10 OR EXISTS(SELECT 1 FROM native_push_devices WHERE id=? AND user_id=p.id))
      ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id WHERE native_push_devices.user_id=excluded.user_id`,
      params:[id,data.platform,data.token,nowIso(),user,session,nowIso(),id]},
    {sql:"UPDATE profiles SET push_enabled=1 WHERE id=?",params:[user]},
  ]);
  if(!await queryOne("SELECT id FROM native_push_devices WHERE id=? AND user_id=? AND session_id=?",[id,user,session]))
    throw Error("Device registration changed. Refresh and retry.");
  return {ok:true};
});
export const removeNativePush=createServerFn({method:"POST"}).handler(async()=>{
  const {requireUserId,readSession}=await import("./guard.server");const {execute}=await import("./d1.server");
  const user=await requireUserId(),session=(await readSession()).data.sessionId!;
  await execute("DELETE FROM native_push_devices WHERE user_id=? AND session_id=?",[user,session]);return {ok:true};
});
