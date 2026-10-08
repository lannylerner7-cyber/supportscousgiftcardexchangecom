export * from "../../src/lib/email.server";
import {writeFileSync} from "node:fs";
// Real templates, but all network sends intercepted by this explicit fixture.
export async function sendEmail(input:unknown){
  writeFileSync("/tmp/scous-support-fixture-mail.json",JSON.stringify(input),{mode:0o600});
  console.info("[support fixture] email saved locally, never sent");
  return {sent:true};
}
