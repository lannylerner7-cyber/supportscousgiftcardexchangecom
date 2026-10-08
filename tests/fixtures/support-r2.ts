const objects=new Map<string,{bytes:ArrayBuffer;contentType:string}>();
export async function putObject(key:string,bytes:ArrayBuffer,contentType:string){objects.set(key,{bytes,contentType});}
export async function getObject(key:string){const o=objects.get(key);return o?{body:o.bytes,contentType:o.contentType}:null;}
export async function deleteObject(key:string){objects.delete(key);}
export {checkImage,MAX_IMAGE_BYTES} from "../../src/lib/image-validation";
export const extensionFor=(type:string)=>type==="image/png"?"png":"jpg";
