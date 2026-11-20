import {memo,useCallback,useSyncExternalStore} from 'react';
import {countDescription,queueCount,queueCountError,subscribeQueueCount} from './queueCounts';

export const QueueCountCell=memo(function QueueCountCell({network,vaultId}:{network:string;vaultId:string}){
 const subscribe=useCallback((listener:()=>void)=>subscribeQueueCount(network,vaultId,listener),[network,vaultId]);
 const get=useCallback(()=>queueCount(network,vaultId),[network,vaultId]);
 const count=useSyncExternalStore(subscribe,get);
 const getError=useCallback(()=>queueCountError(network,vaultId),[network,vaultId]);
 const error=useSyncExternalStore(subscribe,getError);
 const title=count?countDescription(count)+(error?' · '+error:''):error??'Loading waiting offer count';
 return <td data-label="Offers" title={title}>{count?.waiting??'—'}{count&&error&&<small className="sr-only"> · {error}</small>}</td>;
});
