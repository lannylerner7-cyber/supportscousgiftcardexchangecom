import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

const state = globalThis.__nativePasskeyTest = {
  native: false, enabled: false, installed: true, supported: true,
  origin: "https://scousgiftcardexchange.com", calls: [], error: null,
};
// Exercise the installed ESM wrapper and request converter, mocking only the
// Capacitor native boundary. This catches plugin serialization/API regressions.
const pluginEntry = new URL("esm/index.js", import.meta.resolve("@capgo/capacitor-passkey")).href;
const bridge = `
const s=globalThis.__nativePasskeyTest;
export const Capacitor={isNativePlatform:()=>s.native,isPluginAvailable:()=>s.installed};
export const registerPlugin = () => ({
 isSupported: async()=>({available:s.supported}),
 getConfiguration: async()=>({get origin(){return s.origin;}}),
 createCredential: async o=>{s.calls.push(["native-create",o]);if(s.error)throw s.error;return {id:"created"};},
 getCredential: async o=>{s.calls.push(["native-get",o]);if(s.error)throw s.error;return {id:"authenticated"};}
});`;
const mocks = {
  "@capacitor/core": bridge,
  "@simplewebauthn/browser": `const s=globalThis.__nativePasskeyTest;
    export const startRegistration=async o=>{s.calls.push(["web-create",o]);return {id:"created"};};
    export const startAuthentication=async o=>{s.calls.push(["web-get",o]);return {id:"authenticated"};};`,
};
registerHooks({
  resolve(s,c,next) {
    if (s === "@capgo/capacitor-passkey") return {url:pluginEntry,shortCircuit:true};
    if (mocks[s]) return { url: "data:text/javascript,"+encodeURIComponent(mocks[s]), shortCircuit:true };
    try { return next(s,c); } catch(e) {
      if (s.startsWith(".") && c.parentURL?.includes("/capacitor-passkey/dist/esm/")) return next(s+".js",c);
      if (s.startsWith(".") && !s.endsWith(".ts")) return next(s+".ts",c);
      throw e;
    }
  },
  load(url,c,next) {
    if (url.endsWith("/passkey-transport.ts")) return {
      format:"module-typescript",shortCircuit:true,
      source:readFileSync(new URL(url),"utf8").replace(
        'import.meta.env["VITE_NATIVE_PASSKEY_ENABLED"]',
        '(globalThis.__nativePasskeyTest.enabled ? "true" : "false")',
      ),
    };
    return next(url,c);
  },
});
const transport = await import("../src/lib/passkey-transport.ts");
const client = await import("../src/lib/passkey-client.ts");
const creation = {
  rp: {id:"scousgiftcardexchange.com",name:"Scous"}, user:{id:"bWVtYmVy",name:"fixture",displayName:"Fixture"},
  challenge:"Y2hhbGxlbmdl",pubKeyCredParams:[{type:"public-key",alg:-7}],
  authenticatorSelection:{residentKey:"required",userVerification:"required"},
  excludeCredentials:[{id:"ZXhjbHVkZWQ",type:"public-key",transports:["internal"]}],
};
const request = {challenge:"Y2hhbGxlbmdl",rpId:"scousgiftcardexchange.com",userVerification:"required"};

test("browser continues to use SimpleWebAuthn; native bridge is gated and never silently falls back", async()=>{
  await transport.registerPasskey(creation);
  await transport.authenticatePasskey(request);
  assert.deepEqual(state.calls.map(c=>c[0]),["web-create","web-get"]);
  state.calls=[];
  state.native=true;
  await assert.rejects(transport.authenticatePasskey(request),/not enabled/);
  state.enabled=true;state.installed=false;
  await assert.rejects(transport.registerPasskey(creation),/not enabled/);
  state.installed=true;state.supported=false;
  await assert.rejects(transport.authenticatePasskey(request),/cannot use passkeys/);
  state.supported=true;state.origin="https://attacker.invalid";
  await assert.rejects(transport.authenticatePasskey(request),/not configured/);
  assert.deepEqual(state.calls,[]);
  state.origin="https://scousgiftcardexchange.com";
  assert.deepEqual(await transport.registerPasskey(creation),{id:"created"});
  assert.deepEqual(await transport.authenticatePasskey(request),{id:"authenticated"});
  assert.deepEqual(state.calls.map(c=>c[0]),["native-create","native-get"]);
  const registration = JSON.parse(state.calls[0][1].requestJson);
  const authentication = JSON.parse(state.calls[1][1].requestJson);
  assert.equal(state.calls[0][1].origin,state.origin);
  assert.equal(state.calls[1][1].origin,state.origin);
  assert.deepEqual(registration,creation);
  assert.deepEqual(authentication,request);
});

test("native cancellation and duplicate errors use member-safe messaging without invoking browser fallback", async()=>{
  state.error={code:"NotAllowedError",message:"native provider detail"};
  await assert.rejects(transport.authenticatePasskey(request),e=>{
    assert.equal(client.isCancel(e),true);
    assert.match(client.passkeyError(e),/cancelled or timed out/);
    return true;
  });
  assert.match(client.passkeyError({code:"InvalidStateError"}),/already has a passkey/);
  assert.match(client.passkeyError({code:"NotSupportedError"}),/does not support/);
  assert.ok(state.calls.every(c=>c[0].startsWith("native-")));
  state.error=null;
});
