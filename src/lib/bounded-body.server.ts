/** Enforce byte limits even when Content-Length is absent or dishonest. */
export async function boundedBody(request:Request,maximum:number):Promise<Uint8Array|null>{
  if(Number(request.headers.get("content-length")??0)>maximum)return null;
  const reader=request.body?.getReader();
  if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>maximum){await reader.cancel();return null;}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
