import type {V3Network} from '../../src/v3/network';

const indexers = {
 mainnet:'https://bcmr.paytaca.com/api/tokens',
 chipnet:'https://bcmr-chipnet.paytaca.com/api/tokens',
};
const cache = new Map<string,Promise<string|undefined>>();

export function tokenName(network:V3Network,category:string):Promise<string|undefined> {
 if(network==='regtest'||!/[1-9a-f]/.test(category)||!/^[a-f0-9]{64}$/.test(category))return Promise.resolve(undefined);
 const key=network+':'+category;
 const existing=cache.get(key);
 if(existing)return existing;

 // Registry names are display metadata. The category and amounts come from vault state.
 const lookup=fetch(`${indexers[network]}/${category}/`,{
  signal:AbortSignal.timeout(5000),credentials:'omit',referrerPolicy:'no-referrer',
 }).then(async response=>{
  if(!response.ok)return;
  const metadata=await response.json();
  const name=typeof metadata?.name==='string'?metadata.name.trim():'';
  if(metadata?.token?.category===category&&name&&name.length<=100&&!/[\p{C}]/u.test(name))return name;
 }).catch(()=>undefined).then(name=>{
  if(!name)setTimeout(()=>cache.delete(key),60000);
  return name;
 });
 cache.set(key,lookup);
 return lookup;
}

export const shortTokenCategory=(category:string)=>`CashToken ${category.slice(0,8)}…${category.slice(-8)}`;
