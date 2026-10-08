import {useEffect,useState} from "react";
import {Capacitor} from "@capacitor/core";
import {PushNotifications} from "@capacitor/push-notifications";
import {nativePushStatus,saveNativePush,removeNativePush} from "@/lib/native-push.functions";
import {removePush} from "@/lib/push.functions";
export function NativePush(){
  const platform=Capacitor.getPlatform()==="ios"?"ios":"android";
  const [message,setMessage]=useState("Checking native notifications…"),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  async function refresh(){
    const status=await nativePushStatus({data:{platform}});setReady(status.configured);
    const permission=await PushNotifications.checkPermissions();
    setMessage(!status.configured?"Native push provider setup is pending. In-app alerts still work.":permission.receive==="denied"?"Blocked in device settings. In-app alerts still work.":status.enabled?"Enabled for this signed-in session":"Disabled on this device");
  }
  useEffect(()=>{void refresh().catch(()=>setMessage("Could not check native notifications. Please retry."));},[]);
  async function change(action:"enable"|"disable"|"all"){
    setBusy(true);
    try{
      if(action==="enable"){
        if((await PushNotifications.requestPermissions()).receive!=="granted")throw Error("Allow notifications in your device settings. In-app alerts still work.");
        if(platform==="android")await PushNotifications.createChannel({id:"scous_updates",name:"Scous updates",importance:3,visibility:0});
        // Register listeners before requesting a token; never log the token.
        let ok:{remove:()=>Promise<void>}|undefined,bad:{remove:()=>Promise<void>}|undefined;
        try{
          await new Promise<void>((resolve,reject)=>{
            const timeout=setTimeout(()=>reject(Error("Push registration timed out. Please retry.")),20000);
            void (async()=>{
              ok=await PushNotifications.addListener("registration",({value})=>{
                void saveNativePush({data:{platform,token:value}}).then(()=>{clearTimeout(timeout);resolve();},e=>{clearTimeout(timeout);reject(e);});
              });
              bad=await PushNotifications.addListener("registrationError",()=>{clearTimeout(timeout);reject(Error("Push registration failed. Check native provider configuration."));});
              await PushNotifications.register();
            })().catch(e=>{clearTimeout(timeout);reject(e);});
          });
        }finally{await ok?.remove();await bad?.remove();}
      }else{
        if(action==="all")await removePush({data:{all:true}});
        else await removeNativePush();
        await PushNotifications.unregister();
      }
      await refresh();
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="border-border bg-surface rounded-2xl border p-5 space-y-3">
    <h2 className="font-semibold">Native device notifications</h2><p role="status">{message}</p>
    <p className="text-muted-foreground text-xs">Lock-screen messages contain no balances, bank details or card information. Signing out revokes this session’s push registration.</p>
    <div className="flex flex-wrap gap-4 text-primary text-sm">
      <button disabled={!ready||busy} onClick={()=>void change("enable")}>Enable this device</button>
      <button disabled={busy} onClick={()=>void change("disable")}>Disable this device</button>
      <button disabled={busy} onClick={()=>void change("all")}>Disable all devices</button>
    </div>
  </section>;
}
