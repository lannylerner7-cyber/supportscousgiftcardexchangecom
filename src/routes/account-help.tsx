import {createFileRoute,Link} from "@tanstack/react-router";
import {useState} from "react";
import {PublicHeader,PublicFooter} from "@/components/PublicHeader";
import {requestReactivation,sendReactivationCode} from "@/lib/reactivation.functions";
export const Route=createFileRoute("/account-help")({head:()=>({meta:[{title:"Account closure and reactivation — ScousExchange"},{name:"robots",content:"noindex"}]}),component:AccountHelp});
function AccountHelp(){
  const[email,setEmail]=useState(""),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function run(verify:boolean){
    setBusy(true);
    try{
      if(verify){await requestReactivation({data:{email,code}});setMessage("If an inactive account matches, your verified request is now awaiting admin review. This does not reactivate the account yet.");setCode("");}
      else{await sendReactivationCode({data:{email}});setMessage("If this email belongs to an inactive account, a verification code will be sent. Wait at least a minute before retrying.");}
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <><PublicHeader/><main className="mx-auto max-w-2xl px-4 py-12 space-y-6">
    <h1 className="font-display text-3xl font-bold">Account closure and reactivation</h1>
    <p>To deactivate, sign in and open Settings. If you cannot sign in, or want permanent data deletion rather than deactivation, email <a className="text-primary break-all" href="mailto:support@scousgiftcardexchange.com?subject=Account%20closure%20request">support@scousgiftcardexchange.com</a> from your registered email. Never send a password, PIN or gift-card code. Support will verify ownership before acting.</p>
    <p>Deactivation retains your account records and card evidence for possible reactivation; it is not permanent erasure. Withdraw available funds to your linked bank before admin approval. Normal fees and minimums apply. Contact support if your balance is below the minimum or you cannot link a bank.</p>
    <Link to="/login" className="text-primary">Sign in to Settings</Link>
    <section className="border-border bg-surface rounded-2xl border p-5 space-y-4">
      <h2 className="text-xl font-semibold">Request reactivation</h2>
      <p>Verify your registered email. An administrator must approve the request. Previously waived locked promotional credit is not restored.</p>
      <label className="block">Registered email<input type="email" className="bg-background border-border w-full rounded-lg border p-3" value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <button disabled={busy} className="text-primary" onClick={()=>void run(false)}>Email verification code</button>
      <label className="block">Verification code<input inputMode="numeric" maxLength={6} className="bg-background border-border w-full rounded-lg border p-3" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}/></label>
      <button disabled={busy||code.length!==6} className="text-primary" onClick={()=>void run(true)}>Submit verified request</button>
      <p role="status">{message}</p>
    </section>
  </main><PublicFooter/></>;
}
