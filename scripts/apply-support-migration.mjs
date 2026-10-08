import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith(".")&&!s.endsWith(".ts"))return next(s+".ts",c);throw e;}}});
const source=readFileSync(new URL("../src/db/schema.sql",import.meta.url),"utf8");
const block=source.split("-- SUPPORT_CHAT_START")[1]?.split("-- SUPPORT_CHAT_END")[0];
if(!block)throw Error("Support migration missing");
// CASE ... END; inside a trigger is not its closing END at the start of a line.
export const statements=[...block.matchAll(/^CREATE TRIGGER[\s\S]*?^END;|^(?:CREATE (?:TABLE|INDEX)|INSERT INTO)[\s\S]*?;/gm)].map(m=>({sql:m[0]}));
if(!process.argv.includes("--apply"))console.log(`Dry run: ${statements.length} additive support statements; no database accessed. Review the target before --apply.`);
else {
  const {transaction}=await import("../src/lib/d1.server.ts");
  await transaction(statements);
  console.log("Support migration applied.");
}
