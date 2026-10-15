// Explicit isolated browser test only; never used by dev/build/production scripts.
import {defineConfig} from "@lovable.dev/vite-tanstack-config";
import {fileURLToPath} from "node:url";
import {readFileSync} from "node:fs";
process.env["PASSKEY_ENABLED"]="true";
process.env["PASSKEY_RP_ID"]="localhost";
process.env["PASSKEY_ORIGINS"]="https://localhost:3102";
process.env["SESSION_SECRET"]="isolated-passkey-fixture-session-secret-not-for-production";
delete process.env["ADMIN_EMAIL"];
export default defineConfig({
  vite:{
    plugins:[{
      name:"isolated-passkey-fixture",enforce:"pre",
      resolveId(source,importer){
        if(source.includes("d1.server"))return fileURLToPath(new URL("./tests/fixtures/support-db.ts",import.meta.url));
        if(source.includes("r2.server"))return fileURLToPath(new URL("./tests/fixtures/support-r2.ts",import.meta.url));
        if(source.includes("email.server")&&!importer?.includes("support-email"))
          return fileURLToPath(new URL("./tests/fixtures/support-email.ts",import.meta.url));
      },
    }],
    server:{host:"127.0.0.1",port:3102,strictPort:true,allowedHosts:["localhost"],
      https:{key:readFileSync("/tmp/scous-passkey-test.key"),cert:readFileSync("/tmp/scous-passkey-test.crt")}},
  },
  tanstackStart:{server:{entry:"server"}},
});
