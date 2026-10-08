import { useEffect, useState } from "react";
import { pushStatus,savePush,removePush,thisDeviceEnabled } from "@/lib/push.functions";
import {Capacitor} from "@capacitor/core";
import {NativePush} from "./NativePush";
export function DevicePush() {
  const [native,setNative]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()),[]);
  return native?<NativePush/>:<WebDevicePush/>;
}
function WebDevicePush() {
  const [state,setState]=useState("Checking this device…"),[busy,setBusy]=useState(false);
  const [supported,setSupported]=useState(false);
  async function refresh() {
    const ok=window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if(!ok){setState("Device push is unavailable. On iPhone/iPad use iOS 16.4+ and add Scous to your Home Screen. In-app notifications still work.");return;}
    if(Notification.permission==="denied"){setState("Blocked in browser settings. In-app notifications still work.");return;}
    const reg=await navigator.serviceWorker.getRegistration("/");
    const sub=await reg?.pushManager.getSubscription();
    setState(sub && (await thisDeviceEnabled({data:{endpoint:sub.endpoint}})).enabled
      ? "Enabled on this device" : "Disabled on this device");
  }
  useEffect(()=>{void refresh().catch(()=>setState("Unable to check device alerts. Try again."));},[]);
  async function change(enable:boolean,all=false) {
    setBusy(true);
    try {
      if(enable){
        if(await Notification.requestPermission()!=="granted"){await refresh();return;}
        const config=await pushStatus();
        await navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"});
        const reg=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("Service worker is not ready. Refresh and retry.")),15000))]);
        let sub=await reg.pushManager.getSubscription();
        if(sub && !(await thisDeviceEnabled({data:{endpoint:sub.endpoint}})).enabled){
          await sub.unsubscribe();sub=null;
        }
        const raw=atob(config.publicKey.replace(/-/g,"+").replace(/_/g,"/"));
        const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
        sub??=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        const json=sub.toJSON();
        if(!json.endpoint || !json.keys?.["p256dh"] || !json.keys["auth"])throw new Error("Browser returned an incomplete subscription.");
        await savePush({data:{endpoint:json.endpoint,keys:{p256dh:json.keys["p256dh"],auth:json.keys["auth"]}}});
      } else {
        const reg="serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
        const sub=await reg?.pushManager.getSubscription();
        await removePush({data:{all,...(sub?{endpoint:sub.endpoint}:{})}});
        await sub?.unsubscribe();
      }
      await refresh();
    } catch(e){setState((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="border-border bg-surface rounded-2xl border p-5 space-y-3">
    <h2 className="font-semibold">Device notifications</h2>
    <p role="status" className="text-sm text-muted-foreground">{state}</p>
    <p className="text-xs text-muted-foreground">Optional lock-screen alerts contain no amounts, bank details or gift-card information. In-app alerts do not require permission.</p>
    <div className="flex flex-wrap gap-4 text-sm text-primary">
      <button disabled={busy||!supported} onClick={()=>void change(true)}>Enable this device</button>
      <button disabled={busy||!supported} onClick={()=>void change(false)}>Disable this device</button>
      <button disabled={busy} onClick={()=>void change(false,true)}>Disable all devices</button>
    </div>
  </section>;
}
