const origin="https://scousgiftcardexchange.com";
export function nativeRoute(raw:string):string|null{
  try{
    const url=new URL(raw);
    if(url.username||url.password||url.port)return null;
    let path:string;
    if(url.origin===origin)path=url.pathname;
    else if(url.protocol==="scousgiftcardexchange:"&&url.hostname==="app")path="/app"+url.pathname;
    else return null;
    return /^\/app(?:\/(?:notifications|settings|history)(?:\/[a-f0-9-]{36})?)?\/?$/.test(path)?path:null;
  }catch{return null;}
}
