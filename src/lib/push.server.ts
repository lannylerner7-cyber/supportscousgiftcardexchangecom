import webPush from "web-push";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { queryOne, execute } from "./d1.server";

function encryptionKey() {
  const secret=process.env["SESSION_SECRET"];
  if (!secret) throw new Error("Session security is not configured.");
  return createHash("sha256").update("scous-vapid:"+secret).digest();
}
export async function pushKeys(origin: string) {
  let row=await queryOne<{public_key:string;encrypted_private_key:string}>("SELECT public_key,encrypted_private_key FROM push_keys WHERE origin=?", [origin]);
  if (!row) {
    const generated=webPush.generateVAPIDKeys();
    const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
    const bytes=Buffer.concat([cipher.update(generated.privateKey,"utf8"),cipher.final()]);
    const encrypted=Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString("base64");
    await execute("INSERT INTO push_keys(origin,public_key,encrypted_private_key) VALUES(?,?,?) ON CONFLICT(origin) DO NOTHING",[origin,generated.publicKey,encrypted]);
    row=await queryOne("SELECT public_key,encrypted_private_key FROM push_keys WHERE origin=?",[origin]);
  }
  if (!row) throw new Error("Push configuration could not be saved.");
  const bytes=Buffer.from(row.encrypted_private_key,"base64");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  const privateKey=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8");
  return {publicKey:row.public_key,privateKey};
}
export { webPush };
