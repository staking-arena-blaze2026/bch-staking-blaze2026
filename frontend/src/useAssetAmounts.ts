import {useEffect,useState} from 'react';
import type {V3Network} from '../../src/v3/network';
import type {Asset} from '../../src/v2/model';
import {assetAmount,assetInputUnits,assetLabel,amountInputError,priorityRatio,wholeTokenRange} from './assetAmounts';
import {fetchTokenMetadata,tokenMetadataRetryMs,type TokenMetadata} from './tokenMetadata';

export function useTokenMetadata(network:V3Network,categories:readonly string[]){
 const key=[...new Set(categories.map(c=>c.toLowerCase()))]
  .filter(c=>/^[a-f0-9]{64}$/.test(c)&&c!=='0'.repeat(64)).sort().join(',');
 const [resolved,setResolved]=useState<Record<string,TokenMetadata>>({});
 useEffect(()=>{
  if(!key||network==='regtest')return;
  let active=true,timer:ReturnType<typeof setTimeout>;
  const read=async()=>{
   const entries=await Promise.all(key.split(',').map(async category=>{
    const metadata=await fetchTokenMetadata(network,category);
    if(active&&metadata)setResolved(old=>old[network+':'+category]===metadata?old:{...old,[network+':'+category]:metadata});
    return metadata;
   }));
   if(active&&entries.some(metadata=>metadata?.decimals===undefined))timer=setTimeout(read,tokenMetadataRetryMs);
  };
  void read();
  return ()=>{active=false;clearTimeout(timer);};
 },[network,key]);
 return (category:string)=>resolved[network+':'+category.toLowerCase()];
}

export function useAssetAmounts(network:V3Network,assets:readonly (Asset|undefined)[]){
 const tokenMetadata=useTokenMetadata(network,assets.flatMap(a=>a?.kind==='token'?[a.category]:[]));
 const metadata=(a:Asset)=>a.kind==='token'?tokenMetadata(a.category):undefined;
 return {
  metadata,
  assetAmount:(a:Asset,raw:bigint)=>assetAmount(a,raw,metadata(a)),
  assetLabel:(a:Asset)=>assetLabel(a,metadata(a)),
  assetInputUnits:(a:Asset,text:string)=>assetInputUnits(a,text,metadata(a)),
  amountInputError:(a:Asset)=>amountInputError(a,metadata(a)),
  wholeTokenRange:(a:Asset,min:bigint,max:bigint)=>wholeTokenRange(a,min,max,metadata(a)),
  priority:(s:Asset,n:bigint,r:Asset,d:bigint)=>priorityRatio(s,n,r,d,metadata),
 };
}
