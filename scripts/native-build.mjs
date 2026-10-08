import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const mode=process.argv[2];
if(!["apk","aab","ios"].includes(mode))throw Error("Choose apk, aab or ios.");
function run(command,args,cwd=root){
  const result=spawnSync(command,args,{cwd,stdio:"inherit"});
  if(result.error||result.status!==0)throw Error(`${command} failed. Check toolchain and signing setup.`);
}
if(mode==="ios"){
  if(process.platform!=="darwin")throw Error("iOS archive requires macOS and Xcode. No archive was produced.");
  if(!process.env.SCOUS_APPLE_TEAM_ID)throw Error("Set the Apple Team ID through secure build configuration first.");
  if(!["development","production"].includes(process.env.SCOUS_APNS_ENVIRONMENT??""))
    throw Error("Set SCOUS_APNS_ENVIRONMENT to development or production to match the provisioning profile.");
  run("pnpm",["exec","cap","sync","ios"]);
  run("xcodebuild",["-project","ios/App/App.xcodeproj","-scheme","App","-configuration","Release",
    "-destination","generic/platform=iOS","-archivePath","native-output/ScousExchange.xcarchive",
    `DEVELOPMENT_TEAM=${process.env.SCOUS_APPLE_TEAM_ID}`,"CODE_SIGN_ENTITLEMENTS=App/App.entitlements",
    `SCOUS_APNS_ENVIRONMENT=${process.env.SCOUS_APNS_ENVIRONMENT}`,"archive"]);
}else{
  // Refuse a misleading push-enabled build with missing or wrong-project Firebase input.
  // This writes only whitelisted client settings, never the messaging service-account key.
  run("node",["scripts/prepare-firebase.mjs"]);
  if(spawnSync("java",["-version"]).error)throw Error("JDK 21 is required. No Android build was produced.");
  if(!process.env.ANDROID_HOME&&!process.env.ANDROID_SDK_ROOT&&!existsSync(new URL("../android/local.properties",import.meta.url)))
    throw Error("Configure Android SDK 36 before building.");
  if(mode==="aab"&&["SCOUS_ANDROID_KEYSTORE","SCOUS_ANDROID_STORE_PASSWORD","SCOUS_ANDROID_KEY_ALIAS","SCOUS_ANDROID_KEY_PASSWORD"].some(key=>!process.env[key]))
    throw Error("Release AAB requires owner-controlled signing configuration. Debug signing is never used for release.");
  run("pnpm",["exec","cap","sync","android"]);
  run("sh",["gradlew",mode==="apk"?"assembleDebug":"bundleRelease"],root+"android");
}
