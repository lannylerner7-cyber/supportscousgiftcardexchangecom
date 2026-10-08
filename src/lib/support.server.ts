import { z } from "zod";
import { query, queryOne, execute, transaction, nowIso } from "./d1.server";
import { currentUserId, isAdmin, readSession } from "./guard.server";

export class SupportError extends Error {
  status: number;
  constructor(message:string,status=400){super(message);this.name="SupportError";this.status=status;}
}
export type Actor={id:string;admin:boolean;sessionId:string};
export async function supportActor():Promise<Actor>{
  const id=await currentUserId();
  if(!id)throw new SupportError("Please sign in again.",401);
  return {id,admin:await isAdmin(id),sessionId:(await readSession()).data.sessionId!};
}
export async function limit(actor:string,kind:string,max:number,seconds=60){
  const window=Math.floor(Date.now()/(seconds*1000));
  const row=await queryOne(`INSERT INTO support_limits(key,window,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window=excluded.window,
    count=CASE WHEN support_limits.window=excluded.window THEN support_limits.count+1 ELSE 1 END
    WHERE support_limits.window!=excluded.window OR support_limits.count<?
    RETURNING count`,[`${actor}:${kind}`,window,max]);
  if(!row)throw new SupportError("Too many requests. Please wait and try again.",429);
}
export const threadSelect=`SELECT t.*,p.full_name,COALESCE(s.resolved,0) resolved,
  COALESCE(s.user_read,0) user_read,COALESCE(s.admin_read,0) admin_read,
  (SELECT MAX(pr.until) FROM support_presence pr JOIN sessions se ON se.id=pr.session_id
   JOIN profiles pp ON pp.id=se.user_id JOIN user_roles ur ON ur.user_id=se.user_id AND ur.role='admin'
   WHERE pr.thread_id=t.id AND pr.until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND se.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND pp.deleted_at IS NULL) joined_until
  FROM chat_threads t JOIN profiles p ON p.id=t.user_id LEFT JOIN support_state s ON s.thread_id=t.id`;
export async function threadFor(actor:Actor,id:string){
  const thread=await queryOne(`${threadSelect} WHERE t.id=? AND (t.user_id=? OR ?=1)`,[id,actor.id,+actor.admin]);
  if(!thread)throw new SupportError("Conversation not found.",404);
  return thread;
}
const uuid=z.string().uuid();
const cursor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("open")}),
  z.object({action:z.literal("summary")}),
  z.object({action:z.literal("diagnostics")}),
  z.object({action:z.literal("list"),before:cursor.optional()}),
  z.object({action:z.literal("history"),threadId:z.string().max(100),before:cursor.optional(),after:cursor.optional()}),
  z.object({action:z.literal("send"),threadId:z.string().max(100),id:uuid,body:z.string().trim().max(4000),imagePath:z.string().max(300).optional()}),
  z.object({action:z.literal("read"),threadId:z.string().max(100),seq:cursor}),
  z.object({action:z.literal("join"),threadId:z.string().max(100)}),
  z.object({action:z.literal("resolve"),threadId:z.string().max(100),resolved:z.boolean()}),
]);
export async function supportAction(raw:unknown){
  const data=input.parse(raw),actor=await supportActor();
  await limit(actor.id,"api",180);
  if(data.action==="open"){
    // A deterministic id prevents duplicate thread creation from concurrent devices.
    // Prefer a pre-existing conversation so legacy history remains accessible.
    const id=`support-${actor.id}`,now=nowIso();
    await transaction([
      {sql:`INSERT INTO chat_threads(id,user_id,last_message_at,created_at)
        SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM chat_threads WHERE user_id=?)
        ON CONFLICT DO NOTHING`,params:[id,actor.id,now,now,actor.id]},
      {sql:`INSERT INTO support_members(user_id,thread_id)
        SELECT ?,id FROM chat_threads WHERE user_id=? ORDER BY created_at,id LIMIT 1
        ON CONFLICT DO NOTHING`,params:[actor.id,actor.id]},
      {sql:`INSERT INTO support_state(thread_id) SELECT thread_id FROM support_members WHERE user_id=? ON CONFLICT DO NOTHING`,params:[actor.id]},
    ]);
    const member=await queryOne<{thread_id:string}>("SELECT thread_id FROM support_members WHERE user_id=?",[actor.id]);
    return {thread:await threadFor(actor,member!.thread_id)};
  }
  if(data.action==="summary"){
    const row=await queryOne<{unread:number}>(`SELECT COALESCE(SUM(${actor.admin?"unread_for_admin":"unread_for_user"}),0) unread
      FROM chat_threads ${actor.admin?"":"WHERE user_id=?"}`,actor.admin?[]:[actor.id]);
    return row;
  }
  if(data.action==="list"||data.action==="diagnostics"){
    if(!actor.admin)throw new SupportError("Admin access required.",403);
    if(data.action==="diagnostics")return await queryOne(`SELECT
      SUM(CASE WHEN sent_at IS NULL AND attempts<5 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN sent_at IS NULL AND attempts>=5 THEN 1 ELSE 0 END) exhausted FROM support_mail`);
    const rows=await query(`${threadSelect} WHERE t.rowid<? ORDER BY t.rowid DESC LIMIT 51`,[data.before??Number.MAX_SAFE_INTEGER]);
    // Stable inbox pagination by creation rowid (not mutable last-message times).
    const ids=await query<{id:string;cursor:number}>("SELECT id,rowid cursor FROM chat_threads WHERE rowid<? ORDER BY rowid DESC LIMIT 51",[data.before??Number.MAX_SAFE_INTEGER]);
    return {threads:rows.slice(0,50).map(t=>({...t,cursor:ids.find(i=>i.id===t["id"])?.cursor})),hasMore:rows.length>50};
  }
  const thread=await threadFor(actor,data.threadId);
  if(data.action==="history"){
    const forward=data.after!==undefined;
    const messages=await query(`SELECT m.*,o.seq FROM support_order o JOIN chat_messages m ON m.id=o.message_id
      WHERE o.thread_id=? AND o.seq${forward?">":"<"}? ORDER BY o.seq ${forward?"ASC":"DESC"} LIMIT 51`,
      [data.threadId,forward?data.after:data.before??Number.MAX_SAFE_INTEGER]);
    const page=messages.slice(0,50);
    return {messages:forward?page:page.reverse(),hasMore:messages.length>50,thread};
  }
  if(data.action==="send"){
    if(!data.body&&!data.imagePath)throw new SupportError("Write a message or attach a photo.");
    const prior=await queryOne("SELECT m.*,o.seq FROM chat_messages m JOIN support_order o ON o.message_id=m.id WHERE m.id=?",[data.id]);
    if(prior){
      if(prior["sender_id"]!==actor.id||prior["thread_id"]!==data.threadId||prior["body"]!==data.body||prior["image_path"]!==(data.imagePath??null))
        throw new SupportError("This retry differs from the original message.",409);
      return {message:prior};
    }
    await limit(actor.id,"send",30);
    await execute(`INSERT INTO chat_messages(id,thread_id,sender_id,sender_role,body,image_path,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions se JOIN profiles p ON p.id=se.user_id
      WHERE se.id=? AND se.user_id=? AND se.expires_at>? AND p.deleted_at IS NULL)
      ON CONFLICT(id) DO NOTHING`,
      [data.id,data.threadId,actor.id,actor.admin?"admin":"user",data.body,data.imagePath??null,nowIso(),actor.sessionId,actor.id,nowIso()]);
    const message=await queryOne("SELECT m.*,o.seq FROM chat_messages m JOIN support_order o ON o.message_id=m.id WHERE m.id=?",[data.id]);
    if(!message)throw new SupportError("Your session ended. Please sign in again.",401);
    if(message["sender_id"]!==actor.id||message["thread_id"]!==data.threadId||message["body"]!==data.body||message["image_path"]!==(data.imagePath??null))
      throw new SupportError("This retry differs from the original message.",409);
    return {message};
  }
  if(data.action==="read"){
    const col=actor.admin?"admin_read":"user_read",unread=actor.admin?"unread_for_admin":"unread_for_user",role=actor.admin?"user":"admin";
    // Bound the supplied cursor to a real message in this thread. New sends after it stay unread.
    await transaction([
      {sql:`INSERT INTO support_state(thread_id) VALUES(?) ON CONFLICT DO NOTHING`,params:[data.threadId]},
      {sql:`UPDATE support_state SET ${col}=MAX(${col},COALESCE((SELECT seq FROM support_order WHERE thread_id=? AND seq=?),0)) WHERE thread_id=?`,params:[data.threadId,data.seq,data.threadId]},
      {sql:`UPDATE chat_messages SET read_at=COALESCE(read_at,?) WHERE thread_id=? AND sender_role=?
        AND id IN(SELECT message_id FROM support_order WHERE thread_id=? AND seq<=(SELECT ${col} FROM support_state WHERE thread_id=?))`,
        params:[nowIso(),data.threadId,role,data.threadId,data.threadId]},
      {sql:`UPDATE chat_threads SET ${unread}=(SELECT COUNT(*) FROM chat_messages m JOIN support_order o ON o.message_id=m.id
        WHERE m.thread_id=? AND m.sender_role=? AND o.seq>(SELECT ${col} FROM support_state WHERE thread_id=?)) WHERE id=?`,
        params:[data.threadId,role,data.threadId,data.threadId]},
    ]);
    return {ok:true};
  }
  if(!actor.admin)throw new SupportError("Admin access required.",403);
  if(data.action==="join"){
    await execute(`INSERT INTO support_presence(thread_id,session_id,until) VALUES(?,?,?)
      ON CONFLICT(thread_id,session_id) DO UPDATE SET until=excluded.until`,[data.threadId,actor.sessionId,new Date(Date.now()+45000).toISOString()]);
  }else{
    await execute(`INSERT INTO support_state(thread_id,resolved) VALUES(?,?)
      ON CONFLICT(thread_id) DO UPDATE SET resolved=excluded.resolved`,[data.threadId,+data.resolved]);
  }
  return {ok:true};
}
