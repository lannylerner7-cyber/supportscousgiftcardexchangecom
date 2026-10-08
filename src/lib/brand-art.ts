import supplied from "../../scripts/brand-image-sources.json" with {type:"json"};

const existing: Record<string,string> = {
  amazon:"amazon.webp",apple:"apple.jpg",macys:"macys.jpg",walmart:"walmart.png",
  steam:"steam.webp",xbox:"xbox.webp",googleplay:"googleplay.png",sephora:"sephora.jpg",
  nordstrom:"nordstrom.jpg",ebay:"ebay.jpg",visa:"visa.jpg",mastercard:"mastercard.jpg",
  americanexpress:"americanexpress.jpg",nike:"nike.jpg",razer:"razer.jpg",
  playstation:"playstation.jpg",target:"target.jpg",bestbuy:"bestbuy.jpg",vanilla:"vanilla.jpg",
};
export const suppliedBrandSlugs=[...new Set([...Object.keys(existing),...Object.keys(supplied)])];
const repaired:Record<string,string>={footlocker:"footlocker.webp",netflix:"netflix.svg"};
export function brandArt(slug:string,original:string|null):string|null {
  if(Object.hasOwn(repaired,slug))return `/brands/${repaired[slug]}`;
  if(Object.hasOwn(supplied,slug))return `/brands/${slug}.webp`;
  if(Object.hasOwn(existing,slug))return `/brands/${existing[slug]}`;
  return original;
}
