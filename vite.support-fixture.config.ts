import {defineConfig} from "@lovable.dev/vite-tanstack-config";
import {fileURLToPath} from "node:url";
// Explicit test command only; never selected by dev/build or production.
export default defineConfig({
  vite:{
    plugins:[{
      name:"isolated-support-fixture",
      enforce:"pre",
      resolveId(source,importer){
        if(source.includes("d1.server"))return fileURLToPath(new URL("./tests/fixtures/support-db.ts",import.meta.url));
        if(source.includes("r2.server"))return fileURLToPath(new URL("./tests/fixtures/support-r2.ts",import.meta.url));
        if(source.includes("email.server")&&!importer?.includes("support-email"))
          return fileURLToPath(new URL("./tests/fixtures/support-email.ts",import.meta.url));
      },
    }],
    server:{host:"0.0.0.0",port:3101,strictPort:true,allowedHosts:true},
  },
  tanstackStart:{server:{entry:"server"}},
});
