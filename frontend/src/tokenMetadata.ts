import type {V3Network} from '../../src/v3/network';

const indexers = {
 mainnet:'https://bcmr.paytaca.com/api/tokens',
 chipnet:'https://bcmr-chipnet.paytaca.com/api/tokens',
};
export interface TokenMetadata {
 name?:string;
 symbol?:string;
}
const cache = new Map<string,Promise<TokenMetadata|undefined>>();

function displayText(value:unknown):string|undefined {
 if(typeof value!=='string')return;
 const text=value.trim();
 if(text&&text.length<=100&&!/[\p{C}]/u.test(text))return text;
}

export function fetchTokenMetadata(network:V3Network,category:string):Promise<TokenMetadata|undefined> {
 if(network==='regtest'||!/[1-9a-f]/.test(category)||!/^[a-f0-9]{64}$/.test(category))return Promise.resolve(undefined);
 const key=network+':'+category;
 const existing=cache.get(key);
 if(existing)return existing;

 // Registry labels are display metadata. The category and amounts come from vault state.
 const lookup=fetch(`${indexers[network]}/${category}/`,{
  signal:AbortSignal.timeout(5000),credentials:'omit',referrerPolicy:'no-referrer',
 }).then(async response=>{
  if(!response.ok)return;
  const metadata=await response.json();
  if(metadata?.token?.category!==category)return;
  const name=displayText(metadata.name),symbol=displayText(metadata.token.symbol);
  if(name||symbol)return {name,symbol};
 }).catch(()=>undefined).then(metadata=>{
  if(!metadata)setTimeout(()=>cache.delete(key),60000);
  return metadata;
 });
 cache.set(key,lookup);
 return lookup;
}

export const tokenTicker=(category:string,metadata?:TokenMetadata)=>metadata?.symbol??`CashToken ${category.slice(0,8)}…${category.slice(-8)}`;

export function tokenIdentity(category:string,metadata?:TokenMetadata):string {
 const {name,symbol}=metadata??{};
 const label=name&&symbol?`${name} (${symbol})`:name??symbol??'CashToken';
 return `${label} [${category}]`;
}
