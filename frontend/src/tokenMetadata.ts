import type {V3Network} from '../../src/v3/network';

const indexers = {
 mainnet:'https://bcmr.paytaca.com/api/tokens',
 chipnet:'https://bcmr-chipnet.paytaca.com/api/tokens',
};
export interface TokenMetadata {
 name?:string;
 symbol?:string;
 decimals?:number;
}
const cache = new Map<string,{lookup:Promise<TokenMetadata|undefined>;retryAfter?:number}>();
export const tokenMetadataRetryMs=60_000;

function displayText(value:unknown):string|undefined {
 if(typeof value!=='string')return;
 const text=value.trim();
 if(text&&text.length<=100&&!/[\p{C}]/u.test(text))return text;
}

export function fetchTokenMetadata(network:V3Network,category:string):Promise<TokenMetadata|undefined> {
 category=category.toLowerCase();
 if(network==='regtest'||!/[1-9a-f]/.test(category)||!/^[a-f0-9]{64}$/.test(category))return Promise.resolve(undefined);
 const key=network+':'+category;
 const existing=cache.get(key);
 if(existing&&(existing.retryAfter===undefined||existing.retryAfter>Date.now()))return existing.lookup;

 // Registry labels are display metadata. The category and amounts come from vault state.
 const entry={lookup:Promise.resolve(undefined) as Promise<TokenMetadata|undefined>,retryAfter:undefined as number|undefined};
 entry.lookup=Promise.resolve().then(()=>fetch(`${indexers[network]}/${category}/`,{
  signal:AbortSignal.timeout(5000),credentials:'omit',referrerPolicy:'no-referrer',
 })).then(async response=>{
  if(!response.ok)return;
  const metadata=await response.json();
  if(metadata?.token?.category!==category)return;
  const name=displayText(metadata.name),symbol=displayText(metadata.token.symbol);
  const precision:unknown=metadata.token.decimals;
  const decimals=precision===undefined&&symbol?0:
   typeof precision==='number'&&Number.isInteger(precision)&&precision>=0&&precision<=18?precision:undefined;
  if(name||symbol||decimals!==undefined)return {name,symbol,decimals};
 }).catch(()=>undefined).then(metadata=>{
  if(metadata?.decimals===undefined)entry.retryAfter=Date.now()+tokenMetadataRetryMs;
  return metadata;
 });
 cache.set(key,entry);
 return entry.lookup;
}

export const tokenTicker=(category:string,metadata?:TokenMetadata)=>metadata?.symbol??`CashToken ${category.slice(0,8)}…${category.slice(-8)}`;

export function tokenIdentity(category:string,metadata?:TokenMetadata):string {
 const {name,symbol}=metadata??{};
 const label=name&&symbol?`${name} (${symbol})`:name??symbol??'CashToken';
 return `${label} [${category}]`;
}
