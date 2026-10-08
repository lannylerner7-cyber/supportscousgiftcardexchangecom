import {useEffect} from "react";
import {useRouter} from "@tanstack/react-router";
import {useQueryClient} from "@tanstack/react-query";
import {Capacitor} from "@capacitor/core";
import {nativeRoute} from "@/lib/native-policy";
export function NativeRuntime(){
  const router=useRouter(),qc=useQueryClient();
  useEffect(()=>{
    if(!Capacitor.isNativePlatform())return;
    let stopped=false;
    const cleanup:Array<()=>void>=[];
    document.documentElement.classList.add("native-app");
    async function setup(){
      const {App}=await import("@capacitor/app");
      const {PushNotifications}=await import("@capacitor/push-notifications");
      const {StatusBar,Style}=await import("@capacitor/status-bar");
      const listen=async(p:Promise<{remove:()=>Promise<void>}>)=>{const handle=await p;if(stopped)await handle.remove();else cleanup.push(()=>void handle.remove());};
      await listen(App.addListener("appStateChange",({isActive})=>{if(isActive){void qc.invalidateQueries();void router.invalidate();}}));
      await listen(App.addListener("appUrlOpen",({url})=>{const path=nativeRoute(url);if(path)window.location.assign(path);}));
      await listen(App.addListener("backButton",({canGoBack})=>{if(canGoBack)window.history.back();else void App.minimizeApp();}));
      await listen(PushNotifications.addListener("pushNotificationActionPerformed",()=>window.location.assign("/app/notifications")));
      const launch=await App.getLaunchUrl();const path=launch&&nativeRoute(launch.url);if(path&&!stopped)window.location.assign(path);
      await StatusBar.setStyle({style:Style.Dark});
    }
    void setup().catch(()=>console.warn("Some native device features are unavailable."));
    const click=(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target.closest("a"):null;
      if(!target)return;
      const url=new URL(target.href,window.location.href);
      if(url.origin===window.location.origin&&url.protocol==="https:")return;
      event.preventDefault();
      if(url.protocol==="https:"&&!url.username&&!url.password)
        void import("@capacitor/browser").then(({Browser})=>Browser.open({url:url.href}));
      else if(url.protocol==="mailto:"||url.protocol==="tel:")window.location.href=url.href;
    };
    document.addEventListener("click",click,true);
    return()=>{stopped=true;cleanup.forEach(fn=>fn());document.removeEventListener("click",click,true);};
  },[qc,router]);
  return null;
}
