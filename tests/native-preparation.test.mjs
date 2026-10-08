import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {nativeRoute} from "../src/lib/native-policy.ts";
import {brandArt,suppliedBrandSlugs} from "../src/lib/brand-art.ts";
test("all 65 requested catalogue brands resolve to local image files",()=>{
  assert.equal(suppliedBrandSlugs.length,65);
  for(const slug of suppliedBrandSlugs){
    const path=brandArt(slug,null);
    assert.ok(path?.startsWith("/brands/"));
    assert.ok(existsSync(new URL("../public"+path,import.meta.url)),slug);
  }
});
test("Foot Locker and Netflix resolve to real local artwork even when database logos are missing",()=>{
  for(const slug of ["footlocker","netflix"]){
    const path=`/brands/${slug}.${slug==="netflix"?"svg":"webp"}`;
    assert.equal(brandArt(slug,null),path);
    assert.equal(brandArt(slug,"/__l5e/assets-v1/old"),path);
    assert.ok(existsSync(new URL(`../public${path}`,import.meta.url)));
  }
});
test("native links only open allowed member routes on the trusted origin/scheme",()=>{
  assert.equal(nativeRoute("scousgiftcardexchange://app/settings"),"/app/settings");
  assert.equal(nativeRoute("https://scousgiftcardexchange.com/app/notifications?unsafe=https://evil.test"),"/app/notifications");
  for(const url of ["https://evil.test/app","https://scousgiftcardexchange.com.evil.test/app",
    "https://user@scousgiftcardexchange.com/app","javascript:alert(1)","file:///app",
    "scousgiftcardexchange://app/ScousGiftCardExchange/admin","https://scousgiftcardexchange.com/app/../login",
    "http://scousgiftcardexchange.com/app"])assert.equal(nativeRoute(url),null,url);
});
test("native projects disable backups/cleartext and declare platform-specific identity and permissions",()=>{
  const manifest=readFileSync(new URL("../android/app/src/main/AndroidManifest.xml",import.meta.url),"utf8");
  assert.match(manifest,/allowBackup="false"/);
  assert.match(manifest,/usesCleartextTraffic="false"/);
  assert.match(manifest,/POST_NOTIFICATIONS/);
  assert.doesNotMatch(manifest,/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_CONTACTS/);
  const plist=readFileSync(new URL("../ios/App/App/Info.plist",import.meta.url),"utf8");
  assert.match(plist,/com.scousgiftcardexchange.app/);
  assert.match(plist,/NSCameraUsageDescription/);
  assert.match(plist,/WKAppBoundDomains/);
});
