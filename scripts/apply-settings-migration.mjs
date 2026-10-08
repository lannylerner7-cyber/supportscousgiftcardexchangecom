import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}}});
const source=readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8");
const block=source.split("-- SETTINGS_LIFECYCLE_START")[1]?.split("-- SETTINGS_LIFECYCLE_END")[0];
if(!block)throw Error("Migration markers missing.");
const statements=[...block.matchAll(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g)].map(m=>({sql:m[0],params:[]}));
if(statements.length!==8)throw Error("Unexpected migration statement count; inspect schema.");
if(!process.argv.includes("--apply"))console.log("Dry run: eight additive settings statements. Pass --apply after reviewing the target database.");
else{
  const {transaction}=await import("../src/lib/d1.server.ts");
  await transaction(statements);
  console.log("Settings migration applied: five new tables, one index, two inactive-account guards. No existing rows deleted.");
}
