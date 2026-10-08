import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {getAccount,updateProfile,changePassword} from "@/lib/account.functions";
import {closureStatus,requestClosure,cancelClosure} from "@/lib/closure.functions";
import {setSoundEnabled} from "@/lib/sounds";
import {DevicePush} from "./DevicePush";
import {toast} from "sonner";
export function AccountControls(){
  const qc=useQueryClient(),account=useQuery({queryKey:["settings-account"],queryFn:()=>getAccount()});
  const closure=useQuery({queryKey:["closure"],queryFn:()=>closureStatus(),refetchInterval:30000});
  const [name,setName]=useState(""),[phone,setPhone]=useState(""),[hide,setHide]=useState(false),[sound,setSound]=useState(true);
  const [old,setOld]=useState(""),[password,setPassword]=useState(""),[closePassword,setClosePassword]=useState("");
  const [waive,setWaive]=useState(false),[confirm,setConfirm]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{const p=account.data?.profile;if(p){setName(p.full_name);setPhone(p.phone??"");setHide(p.hide_balance_default);setSound(p.sound_enabled);setSoundEnabled(p.sound_enabled);}},[account.data]);
  async function run(fn:()=>Promise<unknown>,success:string){
    if(busy)return;setBusy(true);setMessage("");
    try{await fn();setMessage(success);toast.success(success);await qc.invalidateQueries({queryKey:["profile"]});}
    catch(e){setMessage((e as Error).message);toast.error((e as Error).message);}finally{setBusy(false);}
  }
  const input="border-border bg-surface-2 w-full rounded-xl border px-3 py-3 text-sm";
  return <div className="space-y-5">
    <section className="border-border bg-surface rounded-2xl border p-5 space-y-3">
      <h2 className="font-semibold">Profile and preferences</h2>
      <label className="block text-sm">Full name<input className={input} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="block text-sm">Phone<input type="tel" className={input} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)}/>Hide balance by default</label>
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/>Sound effects</label>
      <button disabled={busy||!account.data} className="text-primary" onClick={()=>void run(async()=>{
        await updateProfile({data:{fullName:name,phone,hideBalanceDefault:hide,soundEnabled:sound}});
        setSoundEnabled(sound);await qc.invalidateQueries({queryKey:["account"]});
      },"Preferences saved.")}>Save preferences</button>
    </section>
    <section className="border-border bg-surface rounded-2xl border p-5 space-y-3">
      <h2 className="font-semibold">Change password</h2>
      <label className="block text-sm">Current password<input type="password" autoComplete="current-password" className={input} value={old} onChange={e=>setOld(e.target.value)}/></label>
      <label className="block text-sm">New password<input type="password" autoComplete="new-password" className={input} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button disabled={busy} className="text-primary" onClick={()=>void run(async()=>{
        const result=await changePassword({data:{currentPassword:old,newPassword:password}});
        if(!result.ok)throw new Error("Current password is incorrect.");setOld("");setPassword("");
      },"Password updated.")}>Update password</button>
    </section>
    <DevicePush/>
    <section className="border-destructive/40 bg-surface rounded-2xl border p-5 space-y-3">
      <h2 className="font-semibold">Deactivate account</h2>
      <p className="text-sm text-muted-foreground">Your records and card evidence are retained for possible reactivation, not permanently erased. Admin approval is required. Withdraw your available balance to your linked bank first; normal fees and minimums apply. If below the minimum, contact support. Pending trades, withdrawals and disputes must settle. We will email you when closure is approved.</p>
      <p className="text-sm">Unlocked rewards remain part of your balance. Only still-locked promotional credit may be waived.</p>
      <a href="/account-help" className="text-primary text-sm">Deletion, deactivation and reactivation help</a>
      {closure.data?.status==="requested"?<div><p role="status">Your request is awaiting admin review. {closure.data.note}</p>
        <button disabled={busy} className="text-primary mt-3 text-sm" onClick={()=>void run(async()=>{await cancelClosure();await closure.refetch();},"Request cancelled.")}>Cancel deactivation request</button></div>:<>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={waive} onChange={e=>setWaive(e.target.checked)}/>I agree to give up any still-locked promotional credit when closure is approved. This waived credit will not be restored.</label>
        <label className="block text-sm">Confirm your password<input type="password" autoComplete="current-password" className={input} value={closePassword} onChange={e=>setClosePassword(e.target.value)}/></label>
        <label className="block text-sm">Type DEACTIVATE<input className={input} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
        <button disabled={busy||confirm!=="DEACTIVATE"} className="text-destructive" onClick={()=>void run(async()=>{
          await requestClosure({data:{password:closePassword,waiveLocked:waive,confirmation:"DEACTIVATE"}});
          setClosePassword("");setConfirm("");await closure.refetch();
        },"Request saved. Your account remains available for settlement until admin approval.")}>Request deactivation</button>
      </>}
    </section>
    {message&&<p role="status" className="text-sm">{message}</p>}
  </div>;
}
