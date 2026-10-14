// Disk-backed isolated object store: restart tests must not rely on process memory.
import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,rename,unlink,writeFile} from "node:fs/promises";
const root="/tmp/scous-support-fixture-r2";
const pathFor=(key:string)=>`${root}/${createHash("sha256").update(key).digest("hex")}.json`;
export async function putObject(key:string,bytes:ArrayBuffer,contentType:string){
  await mkdir(root,{recursive:true,mode:0o700});
  const path=pathFor(key),temporary=`${path}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify({contentType,bytes:Buffer.from(bytes).toString("base64")}),{mode:0o600});
  await rename(temporary,path);
}
export async function getObject(key:string){
  try{
    const object=JSON.parse(await readFile(pathFor(key),"utf8"));
    return {body:Buffer.from(object.bytes,"base64"),contentType:object.contentType};
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
export async function deleteObject(key:string){
  try{await unlink(pathFor(key));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
}
export {checkImage,MAX_IMAGE_BYTES} from "../../src/lib/image-validation";
export const extensionFor=(type:string)=>type==="image/png"?"png":"jpg";
