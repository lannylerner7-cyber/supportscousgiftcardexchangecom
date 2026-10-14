// Explicit product-owned outputs only. --check compares bytes without writing.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const master = await readFile(path.join(root, "public/branding/scous-mark.svg"), "utf8");
const paths = [...master.matchAll(/<path\b[^>]*\/>/g)].map(m => m[0]).join("\n");
if ((paths.match(/<path/g) ?? []).length !== 4) throw new Error("Expected four approved Swap S paths");
const navy = "#141B33";
const svg = (body, w = 64, h = w) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const bg = (w, h = w) => `<rect width="${w}" height="${h}" fill="${navy}"/>`;
const icon = svg(bg(64) + paths);
const maskable = svg(bg(64) + `<g transform="translate(4.8 4.8) scale(.85)">${paths}</g>`);
const foreground = svg(`<g transform="translate(26.8 26.8) scale(.85)">${paths}</g>`, 108);
const outputs = new Map();
const add = (p, data) => outputs.set(p, Buffer.isBuffer(data) ? data : Buffer.from(data));
const png = async (source, w, h = w, opaque = false) => {
  let pipeline = sharp(Buffer.from(source)).resize(w, h);
  if (opaque) pipeline = pipeline.flatten({ background: navy });
  return pipeline.png().toBuffer();
};
add("public/favicon.svg", master);
for (const [name, size] of [["apple-touch-icon",180],["icon-192",192],["icon-512",512]]) {
  add(`public/${name}.png`, await png(icon, size, size, true));
}
add("public/icon-maskable.png", await png(maskable, 512, 512, true));
add("public/branding/scous-symbol.svg", svg(paths));
for (const [name, color] of [["dark",navy],["light","#FFFFFF"]]) {
  add(`public/branding/scous-mono-${name}.svg`, svg(paths.replace(/#F2C230|#2FCB7E/g, color)));
}
// ICO directory with PNG-encoded frames supported by modern browsers/Windows.
const sizes = [16,32,48,64];
const frames = await Promise.all(sizes.map(s => png(master,s)));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
let offset = header.length;
frames.forEach((frame,i) => {
  const p = 6 + i * 16;
  header[p] = sizes[i]; header[p+1] = sizes[i];
  header.writeUInt16LE(1,p+4); header.writeUInt16LE(32,p+6);
  header.writeUInt32LE(frame.length,p+8); header.writeUInt32LE(offset,p+12);
  offset += frame.length;
});
add("public/favicon.ico", Buffer.concat([header,...frames]));
// Existing social target and size; no metadata origins or application copy changed.
add("public/social.png", await png(svg(bg(1200,630) +
  `<g transform="translate(490 70) scale(3.4375)">${paths}</g>` +
  `<text x="600" y="395" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="white">Scous Exchange</text>` +
  `<text x="600" y="465" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#F2C230">Trade gift cards for Naira</text>`,1200,630),1200,630,true));
const res = "android/app/src/main/res";
for (const [density, size, fg] of [["mdpi",48,108],["hdpi",72,162],["xhdpi",96,216],["xxhdpi",144,324],["xxxhdpi",192,432]]) {
  add(`${res}/mipmap-${density}/ic_launcher.png`,await png(icon,size,size,true));
  add(`${res}/mipmap-${density}/ic_launcher_round.png`,await png(svg(`<circle cx="32" cy="32" r="32" fill="${navy}"/>${paths}`),size));
  add(`${res}/mipmap-${density}/ic_launcher_foreground.png`,await png(foreground,fg));
}
add(`${res}/values/ic_launcher_background.xml`, `<resources><color name="ic_launcher_background">${navy}</color></resources>\n`);
add(`${res}/drawable/ic_launcher_background.xml`, `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="${navy}"/></shape>\n`);
// Keep the alternative vector resource consistent even though adaptive XML uses mipmap.
const androidPaths = [...paths.matchAll(/<path\b([^>]*)\/>/g)].map(([,attrs]) => {
  const a = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  return `<path android:pathData="${a.d}" android:fillColor="${a.fill === "none" ? "#00000000" : a.fill}"${a.stroke ? ` android:strokeColor="${a.stroke}" android:strokeWidth="7" android:strokeLineCap="round"` : ""}/>`;
}).join("\n");
add(`${res}/drawable-v24/ic_launcher_foreground.xml`, `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><group android:translateX="26.8" android:translateY="26.8" android:scaleX=".85" android:scaleY=".85">${androidPaths}</group></vector>\n`);
const splash = async (p,w,h) => {
  const size = Math.round(Math.min(w,h)*.24);
  add(p,await png(svg(bg(w,h)+`<g transform="translate(${(w-size)/2} ${(h-size)/2}) scale(${size/64})">${paths}</g>`,w,h),w,h,true));
};
const landscape = [["mdpi",480,320],["hdpi",800,480],["xhdpi",1280,720],["xxhdpi",1600,960],["xxxhdpi",1920,1280]];
for (const [d,w,h] of landscape) {
  await splash(`${res}/drawable-land-${d}/splash.png`,w,h);
  await splash(`${res}/drawable-port-${d}/splash.png`,h,w);
}
await splash(`${res}/drawable/splash.png`,480,320);
const ios = "ios/App/App/Assets.xcassets";
add(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`,await png(icon,1024,1024,true));
for (const suffix of ["","-1","-2"]) await splash(`${ios}/Splash.imageset/splash-2732x2732${suffix}.png`,2732,2732);
let failures = 0;
for (const [p,data] of outputs) {
  const dest = path.join(root,p);
  if (check) {
    const actual = await readFile(dest).catch(()=>null);
    if (!actual?.equals(data)) { console.error(`Missing or stale: ${p}`); failures++; }
  } else {
    await mkdir(path.dirname(dest),{recursive:true}); await writeFile(dest,data);
  }
}
if (failures) throw new Error(`${failures} branding outputs differ; regenerate`);
console.log(`${check ? "Verified" : "Generated"} ${outputs.size} Scous-owned assets`);
