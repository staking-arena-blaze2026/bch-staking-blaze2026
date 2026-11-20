import {memo,useCallback,useSyncExternalStore} from 'react';
import {assetAmount,categoryAsset} from './assetAmounts';
import {localTimestamp} from './localTime';
import {catalogDate,catalogIsStale,queueCatalogColumns} from './queueCatalog';
import {queueCount,subscribeQueueCount} from './queueCounts';
import {queueReward,queueRewardFailed,subscribeQueueReward} from './queueRewards';
import type {TokenMetadata} from './tokenMetadata';

export const QueueRewardCells=memo(function QueueRewardCells({network,vaultId,category,metadata,now}:{
 network:string;vaultId:string;category:string;metadata?:TokenMetadata;now:number;
}){
 const subscribe=useCallback((listener:()=>void)=>subscribeQueueReward(network,vaultId,listener),[network,vaultId]);
 const reward=useSyncExternalStore(subscribe,()=>queueReward(network,vaultId));
 const failed=useSyncExternalStore(subscribe,()=>queueRewardFailed(network,vaultId));
 const stale=reward&&(failed||catalogIsStale(reward.updatedAt,now));
 const title=reward?`Provisional reward data · ${catalogDate(reward.updatedAt)}`:'Reward data unavailable';
 const amount=(raw:string)=>assetAmount(categoryAsset(category),BigInt(raw),metadata);
 const schedule=reward?.schedule;
 const next=schedule?.nextRelease;
 return <>
  <td data-label={queueCatalogColumns[1]} title={title}>{reward?amount(reward.remaining):'Unavailable'}{stale&&' · Stale'}</td>
  <td data-label={queueCatalogColumns[2]} title={schedule?title:'Blockchain time unavailable'}>
   {next===undefined?'Unavailable':next===null?'All releases unlocked':<time dateTime={new Date(next*1000).toISOString()}>{localTimestamp(next)}</time>}{schedule&&stale&&' · Stale'}
  </td>
  <td data-label={queueCatalogColumns[3]} title={schedule?title:'Blockchain time unavailable'}>
   {schedule?amount(schedule.available):'Unavailable'}{schedule&&stale&&' · Stale'}
  </td>
 </>;
});

export function QueueCatalogUpdated({network,vaultIds,now}:{network:string;vaultIds:string[];now:number}){
 const subscribe=useCallback((listener:()=>void)=>{
  const cleanup=vaultIds.flatMap(vaultId=>[subscribeQueueReward(network,vaultId,listener),subscribeQueueCount(network,vaultId,listener)]);
  return ()=>cleanup.forEach(unsubscribe=>unsubscribe());
 },[network,vaultIds]);
 const updatedAt=useSyncExternalStore(subscribe,()=>vaultIds.reduce((latest,vaultId)=>{
  const reward=queueReward(network,vaultId)?.updatedAt,count=queueCount(network,vaultId)?.updatedAt;
  for(const value of [reward,count])if(value&&(!latest||Date.parse(value)>Date.parse(latest)))latest=value;
  return latest;
 },''));
 return <p>Last updated: {updatedAt?<time dateTime={updatedAt}>{catalogDate(updatedAt)}</time>:'Unavailable'}{updatedAt&&catalogIsStale(updatedAt,now)&&' · Stale'}</p>;
}
