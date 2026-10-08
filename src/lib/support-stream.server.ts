import { query } from "./d1.server";
import { threadFor, limit, type Actor, SupportError } from "./support.server";

type Subscriber={key:string;actor:Actor;threadId:string;after:number;controller:ReadableStreamDefaultController<Uint8Array>;last:string;close:()=>void};
const encoder=new TextEncoder();
// This map only groups connections. D1 remains the sole source of truth, so
// writes from any replica are visible. No process-local broadcast dependency.
export class SupportHub {
  subscribers=new Map<string,Subscriber>();
  timer:ReturnType<typeof setTimeout>|undefined;
  busy=false;
  private read:typeof query;
  constructor(read=query){this.read=read;}
  schedule(){
    if(this.timer||!this.subscribers.size)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.tick();},750);
    this.timer.unref?.();
  }
  async tick(){
    if(this.busy)return;
    this.busy=true;
    const subs=[...this.subscribers.values()];
    try{
      if(!subs.length)return;
      // One bounded query per active instance/tick, including revocation,
      // presence, read cursors and replay. Never a query per idle user.
      // JSON uses one bound parameter even at capacity (D1 caps parameters).
      const rows=await this.read(`WITH watchers AS (SELECT
        json_extract(value,'$.key') key,json_extract(value,'$.sid') sid,
        json_extract(value,'$.uid') uid,json_extract(value,'$.admin') admin,
        json_extract(value,'$.tid') tid,json_extract(value,'$.cursor') cursor FROM json_each(?))
        SELECT w.key,
        CASE WHEN se.id IS NOT NULL AND p.deleted_at IS NULL
          AND (CASE WHEN ur.role='admin' THEN 1 ELSE 0 END)=w.admin
          AND (t.user_id=w.uid OR w.admin=1 OR w.tid='summary') THEN 1 ELSE 0 END allowed,
        CASE WHEN w.tid='summary' THEN (SELECT COALESCE(SUM(
          CASE WHEN w.admin=1 THEN unread_for_admin ELSE unread_for_user END),0)
          FROM chat_threads WHERE w.admin=1 OR user_id=w.uid) ELSE NULL END summary_unread,
        CASE WHEN w.tid='inbox' THEN
          (SELECT COALESCE(MAX(seq),0) FROM support_order)||':'||
          (SELECT COALESCE(SUM(unread_for_admin),0)||':'||COUNT(*) FROM chat_threads)||':'||
          (SELECT COALESCE(SUM(resolved),0) FROM support_state)
          ELSE NULL END inbox_version,
        json_object('id',t.id,'user_id',t.user_id,'last_message_at',t.last_message_at,
          'unread_for_admin',t.unread_for_admin,'unread_for_user',t.unread_for_user,
          'resolved',COALESCE(st.resolved,0),'user_read',COALESCE(st.user_read,0),'admin_read',COALESCE(st.admin_read,0),
          'joined_until',(SELECT MAX(pr.until) FROM support_presence pr JOIN sessions ps ON ps.id=pr.session_id
            JOIN profiles pp ON pp.id=ps.user_id JOIN user_roles pu ON pu.user_id=ps.user_id AND pu.role='admin'
            WHERE pr.thread_id=t.id AND pr.until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND ps.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND pp.deleted_at IS NULL)) thread,
        (SELECT json_group_array(json(msg)) FROM (SELECT json_object(
          'id',m.id,'seq',o.seq,'thread_id',m.thread_id,'sender_id',m.sender_id,'sender_role',m.sender_role,
          'body',m.body,'image_path',m.image_path,'read_at',m.read_at,'created_at',m.created_at) msg
          FROM support_order o JOIN chat_messages m ON m.id=o.message_id
          WHERE o.thread_id=w.tid AND o.seq>w.cursor ORDER BY o.seq LIMIT 100)) messages
        FROM watchers w LEFT JOIN sessions se ON se.id=w.sid AND se.user_id=w.uid AND se.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        LEFT JOIN profiles p ON p.id=se.user_id
        LEFT JOIN user_roles ur ON ur.user_id=se.user_id AND ur.role='admin'
        LEFT JOIN chat_threads t ON t.id=w.tid LEFT JOIN support_state st ON st.thread_id=t.id`,
        [JSON.stringify(subs.map(s=>({key:s.key,sid:s.actor.sessionId,uid:s.actor.id,admin:+s.actor.admin,tid:s.threadId,cursor:s.after})))]);
      for(const row of rows){
        const sub=this.subscribers.get(String(row["key"]));if(!sub)continue;
        if(!row["allowed"]){this.emit(sub,"revoked",{});sub.close();continue;}
        if(sub.threadId==="summary"){
          const unread=Number(row["summary_unread"]);
          if(sub.last!==String(unread)){this.emit(sub,"summary",{unread});sub.last=String(unread);}
          else sub.controller.enqueue(encoder.encode(": heartbeat\n\n"));
          if((sub.controller.desiredSize??0)<-16)sub.close();
          continue;
        }
        if(sub.threadId==="inbox"){
          const version=String(row["inbox_version"]);
          if(sub.last!==version){this.emit(sub,"inbox",{version});sub.last=version;}
          else sub.controller.enqueue(encoder.encode(": heartbeat\n\n"));
          if((sub.controller.desiredSize??0)<-16)sub.close();
          continue;
        }
        const messages=JSON.parse(String(row["messages"])) as {seq:number}[];
        const thread=JSON.parse(String(row["thread"]));
        if(messages.length||sub.last!==String(row["thread"])){
          sub.after=Math.max(sub.after,...messages.map(m=>m.seq));
          this.emit(sub,"update",{messages,thread},sub.after);
          sub.last=String(row["thread"]);
        }else sub.controller.enqueue(encoder.encode(": heartbeat\n\n"));
        // Don't buffer unlimited private messages for a stalled browser.
        if((sub.controller.desiredSize??0)<-16)sub.close();
      }
    }catch{
      // On database failure close rather than serve stale permissions/data.
      for(const s of subs)s.close();
    }finally{this.busy=false;this.schedule();}
  }
  emit(s:Subscriber,event:string,data:unknown,id?:number){
    s.controller.enqueue(encoder.encode(`${id===undefined?"":`id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }
  async connect(actor:Actor,threadId:string,after:number,signal:AbortSignal){
    if(threadId==="inbox"){
      if(!actor.admin)throw new SupportError("Admin access required.",403);
    }else if(threadId!=="summary")await threadFor(actor,threadId);
    await limit(actor.id,"stream",20);
    if(this.subscribers.size>=128||[...this.subscribers.values()].filter(s=>s.actor.id===actor.id).length>=4)
      throw new SupportError("Live connection limit reached. Reconnecting shortly.",429);
    let close=()=>{};
    const stream=new ReadableStream<Uint8Array>({
      start:controller=>{
        const key=crypto.randomUUID();
        let closed=false;
        const expiry=setTimeout(()=>close(),240000);expiry.unref?.();
        close=()=>{
          if(closed)return;closed=true;clearTimeout(expiry);
          signal.removeEventListener("abort",close);this.subscribers.delete(key);
          try{controller.close();}catch{/* consumer already closed */}
        };
        const sub={key,actor,threadId,after,controller,last:"",close};
        this.subscribers.set(key,sub);
        signal.addEventListener("abort",close,{once:true});
        if(signal.aborted){close();return;}
        controller.enqueue(encoder.encode("retry: 2000\n\n"));
        this.emit(sub,"ready",{});
        this.schedule();
      },
      cancel:()=>close(),
    });
    return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"private, no-store, no-transform","X-Accel-Buffering":"no","Connection":"keep-alive"}});
  }
}
export const supportHub=new SupportHub();
