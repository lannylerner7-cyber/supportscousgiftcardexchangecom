import {brandArt,suppliedBrandSlugs} from "./brand-art";

// Public display labels supplied by the owner. These are NOT trading records,
// inventory, approved rates, or synthetic database IDs usable for submission.
const names:Record<string,string>={
  amazon:"Amazon",apple:"Apple / iTunes",macys:"Macy's",walmart:"Walmart",steam:"Steam",xbox:"Xbox",
  googleplay:"Google Play",sephora:"Sephora",nordstrom:"Nordstrom",ebay:"eBay",visa:"Visa",
  mastercard:"Mastercard",americanexpress:"American Express",nike:"Nike",razer:"Razer Gold",
  playstation:"PlayStation",target:"Target",bestbuy:"Best Buy",vanilla:"Vanilla",
  wayfair:"Wayfair","ulta-beauty":"Ulta Beauty",twitch:"Twitch",subway:"Subway",kfc:"KFC",
  "southwest-airlines":"Southwest Airlines","sam-s-club":"Sam's Club",roblox:"Roblox",rei:"REI",
  "papa-murphy-s":"Papa Murphy's",paramount:"Paramount+","panda-express":"Panda Express",
  "old-navy":"Old Navy",nintendo:"Nintendo","microsoft-365-personal":"Microsoft 365 Personal",
  "meta-quest":"Meta Quest",lyft:"Lyft","kohl-s":"Kohl's",jcpenney:"JCPenney",instacart:"Instacart",
  ikea:"IKEA",hulu:"Hulu","hotels-com":"Hotels.com","the-home-depot":"The Home Depot","h-m":"H&M",
  "google-workspace":"Google Workspace",gap:"Gap",gamestop:"GameStop",etsy:"Etsy","domino-s":"Domino's",
  disney:"Disney","delta-air-lines":"Delta Air Lines","cvs-pharmacy":"CVS Pharmacy",chewy:"Chewy",
  belk:"Belk","bass-pro-shops":"Bass Pro Shops","baby-gap":"Baby Gap","applebee-s":"Applebee's",
  amtrak:"Amtrak",airbnb:"Airbnb",adidas:"Adidas","microsoft-365-business-standard":"Microsoft 365 Business Standard",
  "1-800-flowers-com":"1-800-Flowers.com","uber-uber-eats":"Uber / Uber Eats",doordash:"DoorDash","lowe-s":"Lowe's",
};
type HomepageRow={
  id:string;name:string;slug:string;accent_color:string|null;logo_url:string|null;is_visible:number;
};
export function completeHomepageCatalogue(rows:HomepageRow[]){
  const entries=rows.map(row=>({...row,logo_url:brandArt(row.slug,row.logo_url),catalogueOnly:!row.is_visible}));
  const present=new Set(rows.map(row=>row.slug));
  for(const slug of suppliedBrandSlugs){
    if(present.has(slug))continue;
    const name=names[slug];
    if(!name)throw Error(`Public catalogue label missing for ${slug}`);
    entries.push({id:`showcase:${slug}`,name,slug,accent_color:null,logo_url:brandArt(slug,null),
      is_visible:0,catalogueOnly:true});
  }
  return entries;
}
