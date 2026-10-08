import {query,queryOne,execute,nowIso} from "./d1.server";
import {nativePushReady,sendNativePush,type NativePlatform} from "./native-push.server";
import {draining,measure} from "./observability.server";
export async function deliverNative(){
  for(const platform of ["android","ios"] as const){
    if(!nativePushReady(platform))continue;
    await execute(`INSERT INTO native_push_deliveries(id,device_id,notification_id,next_at)
      SELECT d.id||':'||n.id,d.id,n.id,? FROM native_push_devices d JOIN notifications n ON n.user_id=d.user_id
      JOIN profiles p ON p.id=d.user_id JOIN sessions s ON s.id=d.session_id
      WHERE d.platform=? AND p.deleted_at IS NULL AND p.push_enabled=1 AND s.expires_at>?
      AND n.read_at IS NULL AND n.created_at>=d.created_at AND n.created_at>?
      ON CONFLICT(device_id,notification_id) DO NOTHING`,
      [nowIso(),platform,nowIso(),new Date(Date.now()-86400000).toISOString()]);
    const jobs=await query<{id:string;device_id:string;token:string;platform:NativePlatform;attempts:number}>(
      `SELECT j.id,j.device_id,j.attempts,d.token,d.platform FROM native_push_deliveries j
      JOIN native_push_devices d ON d.id=j.device_id JOIN profiles p ON p.id=d.user_id
      JOIN sessions s ON s.id=d.session_id JOIN notifications n ON n.id=j.notification_id
      WHERE d.platform=? AND p.deleted_at IS NULL AND p.push_enabled=1 AND s.expires_at>? AND n.read_at IS NULL
      AND j.sent_at IS NULL AND j.attempts<5 AND j.next_at<=? AND (j.lease_until IS NULL OR j.lease_until<?)
      ORDER BY j.next_at LIMIT 20`,[platform,nowIso(),nowIso(),nowIso()]);
    for(const job of jobs){
      if(draining)break;
      const lease=crypto.randomUUID();
      if(!await queryOne(`UPDATE native_push_deliveries SET attempts=attempts+1,lease_token=?,lease_until=?
        WHERE id=? AND sent_at IS NULL AND attempts<5 AND (lease_until IS NULL OR lease_until<?) RETURNING id`,
        [lease,new Date(Date.now()+120000).toISOString(),job.id,nowIso()]))continue;
      try{
        if(!await queryOne(`SELECT d.id FROM native_push_devices d JOIN profiles p ON p.id=d.user_id
          JOIN sessions s ON s.id=d.session_id WHERE d.id=? AND p.deleted_at IS NULL AND p.push_enabled=1 AND s.expires_at>?`,
          [job.device_id,nowIso()]))continue;
        if(await sendNativePush(job.platform,job.token,job.id)==="expired")await execute("DELETE FROM native_push_devices WHERE id=?",[job.device_id]);
        else await execute("UPDATE native_push_deliveries SET sent_at=?,lease_until=NULL WHERE id=? AND lease_token=?",[nowIso(),job.id,lease]);
      }catch{
        measure("delivery",0,false);
        await execute("UPDATE native_push_deliveries SET next_at=?,lease_until=NULL WHERE id=? AND lease_token=?",
          [new Date(Date.now()+Math.min(3600000,60000*2**job.attempts)).toISOString(),job.id,lease]);
      }
    }
  }
}
