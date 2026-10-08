import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}}});
const schema=readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8");
const block=schema.split("-- NATIVE_PUSH_START")[1]?.split("-- NATIVE_PUSH_END")[0];
if(!block)throw Error("Native migration markers missing.");
const statements=[...block.matchAll(/CREATE (?:TABLE|INDEX)[\s\S]*?;/g)].map(m=>({sql:m[0],params:[]}));
if(statements.length!==3)throw Error("Unexpected migration size.");
if(!process.argv.includes("--apply"))console.log("Dry run: two native push tables and one index. No account/balance changes.");
else {const {transaction}=await import("../src/lib/d1.server.ts");await transaction(statements);console.log("Native push migration applied; no existing rows changed.");}
