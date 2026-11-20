import type {OfferCount} from '../../src/queue/catalog';

import {catalogDate,catalogIsStale} from './queueCatalog';

const entries=new Map<string,OfferCount>();
const errors=new Map<string,string>();
const listeners=new Map<string,Set<()=>void>>();
const key=(network:string,vaultId:string)=>`arena-queue-count-v1-${network}-${vaultId}`;

function valid(network:string,vaultId:string,value:unknown):value is OfferCount{
 const c=value as OfferCount|undefined;
 return !!c&&c.network===network&&c.vaultId===vaultId&&Number.isSafeInteger(c.waiting)&&c.waiting>=0&&
  typeof c.updatedAt==='string'&&Number.isFinite(Date.parse(c.updatedAt))&&Date.parse(c.updatedAt)<=Date.now()+60000;
}

export function queueCount(network:string,vaultId:string){
 const k=key(network,vaultId),memory=entries.get(k);
 if(memory)return memory;
 try{
  const value=JSON.parse(localStorage.getItem(k)??'null');
  if(valid(network,vaultId,value)){entries.set(k,value);return value;}
 }catch{/* Storage is optional. */}
}

export function rememberQueueCount(network:string,vaultId:string,value:unknown){
 if(!valid(network,vaultId,value))return;
 const previous=queueCount(network,vaultId);
 if(previous&&Date.parse(previous.updatedAt)>=Date.parse(value.updatedAt))return;
 const k=key(network,vaultId);
 entries.set(k,value);
 try{localStorage.setItem(k,JSON.stringify(value));}catch{/* In-memory counts remain available. */}
 for(const listener of listeners.get(k)??[])listener();
}

export function subscribeQueueCount(network:string,vaultId:string,listener:()=>void){
 const k=key(network,vaultId),group=listeners.get(k)??new Set();
 listeners.set(k,group);group.add(listener);
 return ()=>{group.delete(listener);if(!group.size)listeners.delete(k);};
}

export function queueCountError(network:string,vaultId:string){return errors.get(key(network,vaultId));}
export function setQueueCountError(network:string,vaultId:string,error?:string){
 const k=key(network,vaultId);
 if(errors.get(k)===error)return;
 if(error)errors.set(k,error);else errors.delete(k);
 for(const listener of listeners.get(k)??[])listener();
}

export function countDescription(count:OfferCount,now=Date.now()){
 return `${catalogIsStale(count.updatedAt,now)?'Stale p':'P'}rovisional waiting offers · ${catalogDate(count.updatedAt)}`;
}
