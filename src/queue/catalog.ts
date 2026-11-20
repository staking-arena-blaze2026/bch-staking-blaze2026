import {boundedMap} from '../bounded-map.js';
import type {ElectrumCore} from '../electrum-core.js';
import {v3Network,type V3Network} from '../v3/network.js';
import type {Config} from './chain.js';
import {snapshot} from './indexer.js';
import {arena,node,readState,root} from './protocol.js';
import {queueRewardSchedule} from './reward-schedule.js';

export interface OfferCount {network:V3Network;vaultId:string;waiting:number;updatedAt:string}
export interface CatalogReward {
 network:V3Network;
 vaultId:string;
 remaining:string;
 schedule?:{available:string;nextRelease:number|null};
 updatedAt:string;
}
export interface CatalogTarget {config:Config;reward:boolean;count:boolean}
export interface CatalogObservation {
 vaultId:string;
 kind:'reward'|'count';
 reward?:CatalogReward;
 count?:OfferCount;
}

export function catalogReward(network:V3Network,config:Config,remaining:bigint,mtp:number|undefined,updatedAt:string):CatalogReward {
 const schedule=mtp===undefined?undefined:queueRewardSchedule(config.parameters,remaining,mtp);
 return {network,vaultId:config.anchor.genesis,remaining:remaining.toString(),updatedAt,
  schedule:schedule&&{available:schedule.available.toString(),nextRelease:schedule.nextRelease??null}};
}

/** Provisional marketplace data. Share one pinned session and exact-tip clock.
 * Reward reads use only the vault output. The count pass reuses that output
 * and checks the entire queue only for rows whose counts need refreshing. */
export async function readQueueCatalog(
 p:ElectrumCore,targets:readonly CatalogTarget[],observe:(value:CatalogObservation)=>void,deadline=Infinity,
){
 if(!targets.length)return;
 const network=v3Network(p);
 await p.session(async()=>{
  const tip=await p.tip();
  const clock=targets.some(t=>t.reward)?p.medianTime(tip.height,tip.hash).catch(()=>undefined):undefined;
  // Leave part of the publisher's budget for counts when the catalog is large.
  const stateDeadline=Date.now()+(deadline-Date.now())/2;
  const states=await boundedMap(targets,4,async ({config,reward,count})=>{
   if(Date.now()>=stateDeadline)return;
   const vaultId=config.anchor.genesis,c={p:config.parameters,identity:config.identity,provider:p};
   try{
    const rows=await p.reportedUtxosForLockingBytecode(arena(c).lockingBytecode);
    const vaults=rows.filter(u=>u.token?.category===c.identity.vault);
    if(vaults.length!==1)throw Error('Vault uniqueness failure');
    const {reserve}=readState(c,vaults[0]!);
    const updatedAt=new Date().toISOString();
    if(reward)observe({vaultId,kind:'reward',reward:catalogReward(network,config,reserve,await clock,updatedAt)});
    if(count)return {vaultId,c,vault:vaults[0]!};
   }catch{
    if(reward)observe({vaultId,kind:'reward'});
    if(count)observe({vaultId,kind:'count'});
   }
  });
  for(let at=0;at<states.length&&Date.now()<deadline;at+=4){
   const batch=states.slice(at,at+4).filter(state=>state!==undefined);
   if(!batch.length)continue;
   const counts=await boundedMap(batch,4,async ({vaultId,c,vault})=>{
    try {
     const lists=await boundedMap([node(c),root(c)],2,contract=>p.reportedUtxosForLockingBytecode(contract.lockingBytecode));
     const rows=lists.flat().filter(u=>u.token?.category===c.identity.queue||u.token?.category===c.identity.vault);
     return {vaultId,count:{network,vaultId,waiting:snapshot(c,[vault,...rows]).ordered.length,updatedAt:new Date().toISOString()}};
    }catch{return {vaultId};}
   });
   const sameTip=(await p.tip().catch(()=>undefined))?.hash===tip.hash;
   for(const {vaultId,count} of counts)observe({vaultId,kind:'count',count:sameTip?count:undefined});
   if(!sameTip)break;
  }
  await clock;
 });
}
