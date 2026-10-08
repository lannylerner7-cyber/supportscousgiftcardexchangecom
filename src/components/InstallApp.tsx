import { useEffect, useState } from "react";
import {Capacitor} from "@capacitor/core";
export function InstallApp() {
  const [native,setNative]=useState(false);
  const [comingSoon,setComingSoon]=useState("");
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if(Capacitor.isNativePlatform()){setNative(true);return;}
    const install = (e: Event) => { e.preventDefault(); };
    window.addEventListener("beforeinstallprompt", install);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope:"/", updateViaCache:"none" }).then(reg => {
        if (reg.waiting) setUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdate(worker);
          });
        });
      }).catch(() => setError("Update checks are unavailable. Reconnect and refresh."));
    }
    return () => { window.removeEventListener("beforeinstallprompt",install); };
  }, []);
  if(native)return null;
  return <section id="mobile-apps" aria-label="Scous mobile apps" className="mx-auto mt-8 max-w-3xl scroll-mt-24 px-4 py-5 text-center text-sm">
    <div className="flex flex-wrap items-center justify-center gap-4">
      <button type="button" aria-label="Google Play — coming soon"
        className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        onClick={()=>setComingSoon("Coming soon on Google Play.")}>
        <img src="/google-play-badge.png" alt="Get it on Google Play" className="h-12 w-auto" width={162} height={48}/>
      </button>
      <button type="button" aria-label="App Store — coming soon"
        className="rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        onClick={()=>setComingSoon("Coming soon on the App Store.")}>
        <img src="/app-store-badge.svg" alt="Download on the App Store" className="h-12 w-auto" width={144} height={48}/>
      </button>
    </div>
    <p role="status" aria-live="polite" className="text-primary mt-3 min-h-6 font-medium">{comingSoon}</p>
    {update && <div className="mt-3"><p>A new version is ready. Finish any submission before updating.</p>
      <button className="text-primary" onClick={() => {
        navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {once:true});
        update.postMessage("ACTIVATE_UPDATE");
      }}>Update and reload</button></div>}
    {error && <p role="status">{error}</p>}
  </section>;
}
