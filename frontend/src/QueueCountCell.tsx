import {memo,useCallback,useSyncExternalStore} from 'react';
import {catalogIsStale} from './queueCatalog';
import {countDescription,queueCount,queueCountError,subscribeQueueCount} from './queueCounts';

export const QueueCountCell=memo(function QueueCountCell({network,vaultId,now}:{network:string;vaultId:string;now:number}){
 const subscribe=useCallback((listener:()=>void)=>subscribeQueueCount(network,vaultId,listener),[network,vaultId]);
 const get=useCallback(()=>queueCount(network,vaultId),[network,vaultId]);
 const count=useSyncExternalStore(subscribe,get);
 const getError=useCallback(()=>queueCountError(network,vaultId),[network,vaultId]);
 const error=useSyncExternalStore(subscribe,getError);
 const title=count?countDescription(count)+(error?' · '+error:''):error??'Waiting offer count unavailable';
 return <td data-label="Offers" title={title}>{count?.waiting??'Unavailable'}{count&&(error||catalogIsStale(count.updatedAt,now))&&' · Stale'}{count&&error&&<small className="sr-only"> · {error}</small>}</td>;
});
