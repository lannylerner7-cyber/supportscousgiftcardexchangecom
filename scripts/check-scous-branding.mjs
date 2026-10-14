import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = p => readFile(path.join(root,p),"utf8");
const dimensions = async (p,w,h=w,opaque=false) => {
  const m = await sharp(path.join(root,p)).metadata();
  assert.equal(m.width,w,p); assert.equal(m.height,h,p);
  if (opaque) assert.equal(m.hasAlpha,false,`${p} must be opaque`);
};
const manifest = JSON.parse(await read("public/manifest.webmanifest"));
for (const icon of manifest.icons) {
  const [w,h] = icon.sizes.split("x").map(Number);
  await dimensions(`public${icon.src}`,w,h,true);
}
await dimensions("public/apple-touch-icon.png",180,180,true);
await dimensions("public/social.png",1200,630,true);
// All colored maskable pixels must fit the W3C central 80%-diameter circle.
const mask = await sharp(path.join(root,"public/icon-maskable.png")).raw().toBuffer({resolveWithObject:true});
for(let y=0;y<512;y++) for(let x=0;x<512;x++) {
  const p=(y*512+x)*mask.info.channels;
  const [r,g,b]=mask.data.subarray(p,p+3);
  if(Math.max(Math.abs(r-20),Math.abs(g-27),Math.abs(b-51))>12) {
    assert.ok(Math.hypot(x-255.5,y-255.5)<204.8,"Maskable artwork outside safe circle");
  }
}
const ico = await readFile(path.join(root,"public/favicon.ico"));
assert.equal(ico.readUInt16LE(2),1); assert.equal(ico.readUInt16LE(4),4);
for(const [i,s] of [16,32,48,64].entries()){
  const p=6+i*16; assert.equal(ico[p],s); assert.equal(ico[p+1],s);
  const start=ico.readUInt32LE(p+12), len=ico.readUInt32LE(p+8);
  const m=await sharp(ico.subarray(start,start+len)).metadata();
  assert.equal(m.width,s); assert.equal(m.height,s);
}
const res="android/app/src/main/res";
for(const [d,size,fg] of [["mdpi",48,108],["hdpi",72,162],["xhdpi",96,216],["xxhdpi",144,324],["xxxhdpi",192,432]]) {
  await dimensions(`${res}/mipmap-${d}/ic_launcher.png`,size);
  await dimensions(`${res}/mipmap-${d}/ic_launcher_round.png`,size);
  await dimensions(`${res}/mipmap-${d}/ic_launcher_foreground.png`,fg);
}
for(const name of ["ic_launcher","ic_launcher_round"]) {
  const xml=await read(`${res}/mipmap-anydpi-v26/${name}.xml`);
  assert.match(xml,/@mipmap\/ic_launcher_foreground/);
  assert.match(xml,/@color\/ic_launcher_background/);
}
const ios="ios/App/App/Assets.xcassets";
for(const dir of ["AppIcon.appiconset","Splash.imageset"]) {
  const catalog=JSON.parse(await read(`${ios}/${dir}/Contents.json`));
  for(const image of catalog.images) {
    const size=dir.startsWith("AppIcon")?1024:2732;
    await dimensions(`${ios}/${dir}/${image.filename}`,size,size,true);
  }
}
const head=await read("src/routes/__root.tsx");
for(const [,url] of head.matchAll(/href: "(\/(?:favicon[^"]+|apple-touch-icon[^"]+|manifest[^"]+))"/g)) {
  await access(path.join(root,"public",url.slice(1)));
}
// Optional request check uses the preview host, never the production site.
if (process.argv.includes("--http")) {
  assert.ok(process.env.REPLIT_DEV_DOMAIN,"Preview host required");
  for(const url of ["/branding/scous-mark.svg","/favicon.svg","/favicon.ico","/apple-touch-icon.png","/icon-192.png","/icon-512.png","/icon-maskable.png","/social.png","/manifest.webmanifest"]) {
    const r=await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}${url}`);
    assert.equal(r.status,200,url);
    assert.match(r.headers.get("content-type")??"",url.endsWith("webmanifest")?/json/:/image\//);
    const bytes=Buffer.from(await r.arrayBuffer());
    assert.ok(bytes.equals(await readFile(path.join(root,"public",url.slice(1)))),`${url} response differs from asset`);
  }
}
console.log("Brand dimensions, opacity, safe zone, ICO frames, catalogs and references passed");
