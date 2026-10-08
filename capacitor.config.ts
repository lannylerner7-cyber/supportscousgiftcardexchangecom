import type {CapacitorConfig} from "@capacitor/cli";

// REMOTE-HOSTED TEST HARNESS, NOT A STORE-READY RELEASE.
// The existing TanStack server must remain on Coolify; do not copy SSR output
// into webDir or describe server.url as supported production packaging.
const config:CapacitorConfig={
  appId:"com.scousgiftcardexchange.app",
  appName:"ScousExchange",
  webDir:"native-web",
  server:{
    url:"https://scousgiftcardexchange.com",
    cleartext:false,
    allowNavigation:[],
    errorPath:"offline.html",
  },
  android:{allowMixedContent:false,webContentsDebuggingEnabled:false},
  ios:{contentInset:"automatic",limitsNavigationsToAppBoundDomains:true},
  plugins:{
    SplashScreen:{launchAutoHide:true,launchShowDuration:1200,backgroundColor:"#0d1220"},
    PushNotifications:{presentationOptions:["badge","sound","alert"]},
  },
};
export default config;
