import type {CatalogReward} from '../../src/queue/catalog';

const entries=new Map<string,CatalogReward>();
const failures=new Set<string>();
const listeners=new Map<string,Set<()=>void>>();
const key=(network:string,vaultId:string)=>`arena-queue-reward-v1-${network}-${vaultId}`;
const amount=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9]\d{0,9})$/.test(value);

function valid(network:string,vaultId:string,value:unknown):value is CatalogReward{
 const reward=value as CatalogReward|undefined;
 return !!reward&&reward.network===network&&reward.vaultId===vaultId&&amount(reward.remaining)&&
  typeof reward.updatedAt==='string'&&Number.isFinite(Date.parse(reward.updatedAt))&&Date.parse(reward.updatedAt)<=Date.now()+60000&&
  (reward.schedule===undefined||!!reward.schedule&&amount(reward.schedule.available)&&BigInt(reward.schedule.available)<=BigInt(reward.remaining)&&
   (reward.schedule.nextRelease===null||Number.isSafeInteger(reward.schedule.nextRelease)&&reward.schedule.nextRelease>=500000000&&reward.schedule.nextRelease<=2147483647));
}

export function queueReward(network:string,vaultId:string){
 const k=key(network,vaultId),cached=entries.get(k);
 if(cached)return cached;
 try{
  const value=JSON.parse(localStorage.getItem(k)??'null');
  if(valid(network,vaultId,value)){entries.set(k,value);return value;}
 }catch{/* Storage is optional. */}
}

export function rememberQueueReward(network:string,vaultId:string,value:unknown){
 if(!valid(network,vaultId,value))return;
 const k=key(network,vaultId),previous=queueReward(network,vaultId);
 if(previous&&Date.parse(previous.updatedAt)>=Date.parse(value.updatedAt))return;
 entries.set(k,value);failures.delete(k);
 try{localStorage.setItem(k,JSON.stringify(value));}catch{/* In-memory rewards remain available. */}
 for(const listener of listeners.get(k)??[])listener();
}

export function queueRewardFailed(network:string,vaultId:string){return failures.has(key(network,vaultId));}
export function markQueueRewardFailed(network:string,vaultId:string){
 const k=key(network,vaultId);
 if(failures.has(k))return;
 failures.add(k);
 for(const listener of listeners.get(k)??[])listener();
}

export function subscribeQueueReward(network:string,vaultId:string,listener:()=>void){
 const k=key(network,vaultId),group=listeners.get(k)??new Set();
 listeners.set(k,group);group.add(listener);
 return ()=>{group.delete(listener);if(!group.size)listeners.delete(k);};
}
