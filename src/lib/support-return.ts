/** Only known support destinations survive sign-in; never accept external redirects. */
export function supportReturn(value:unknown):string|undefined {
  if(typeof value!=="string")return undefined;
  if(value==="/app/chat")return value;
  const match=/^\/ScousGiftCardExchange\/admin\/messages\?thread=([A-Za-z0-9-]{1,100})$/.exec(value);
  return match?`/ScousGiftCardExchange/admin/messages?thread=${match[1]}`:undefined;
}
