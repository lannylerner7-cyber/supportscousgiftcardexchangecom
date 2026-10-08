import {createFileRoute} from "@tanstack/react-router";
import {useQuery} from "@tanstack/react-query";
import {useState} from "react";
import {listClosures,reviewClosure} from "@/lib/closure.functions";
import {closureBlock} from "@/lib/closure-policy";
import {naira} from "@/lib/format";
export const Route=createFileRoute("/_authenticated/ScousGiftCardExchange/admin/closures")({component:Closures});
function Closures(){
  const q=useQuery({queryKey:["admin-closures"],queryFn:()=>listClosures(),refetchInterval:30000});
  const [notes,setNotes]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function review(id:string,action:"close"|"reactivate"|"note"){
    setBusy(true);setMessage("");
    try{await reviewClosure({data:{id,action,note:notes[id]??""}});await q.refetch();setMessage("Review saved.");}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="space-y-5"><h1 className="text-xl font-bold">Account closure reviews</h1>
    <p className="text-sm">Settle withdrawals through the existing payout desk first. Closing does not initiate or confirm a bank transfer. Frozen accounts/disputes must be resolved first. Records remain retained.</p>
    {q.isPending&&<p>Loading requests…</p>}{q.isError&&<p role="alert">Could not load requests.</p>}
    {q.data?.length===0&&<p>No closure requests.</p>}
    {q.data?.map(c=><section key={c.id} className="border-border bg-surface rounded-2xl border p-5 space-y-3">
      <h2 className="font-semibold">{c.full_name} · {c.status}</h2><p className="break-all text-sm">{c.email}</p>
      <p className="text-sm">Available: {naira((c.balance_naira-c.locked_naira)/100)} · Held: {naira(c.held_naira/100)} · Locked promotion: {naira(c.locked_naira/100)} · Pending: {c.pending}</p>
      <p className="text-sm">{closureBlock(c.balance_naira,c.held_naira,c.locked_naira,c.pending,!!c.frozen_at,!!c.waive_locked)??"Wallet settlement checks passed. Final checks run on approval."}</p>
      {c.note&&<p className="text-sm">Previous note: {c.note}</p>}
      {c.mail_status&&<p className="text-sm">Email: {c.mail_status}</p>}
      <label className="block text-sm">Review note (sent to member when posting an update)<textarea className="bg-background border-border mt-1 w-full rounded-lg border p-3" value={notes[c.id]??""} onChange={e=>setNotes({...notes,[c.id]:e.target.value})}/></label>
      <div className="flex flex-wrap gap-4 text-sm text-primary">
        {c.status==="requested"&&<button disabled={busy} onClick={()=>void review(c.id,"close")}>Approve deactivation</button>}
        {c.status==="reactivation_requested"&&<button disabled={busy} onClick={()=>void review(c.id,"reactivate")}>Approve reactivation</button>}
        <button disabled={busy} onClick={()=>void review(c.id,"note")}>Send support update</button>
      </div>
    </section>)}
    <p role="status">{message}</p>
  </div>;
}
