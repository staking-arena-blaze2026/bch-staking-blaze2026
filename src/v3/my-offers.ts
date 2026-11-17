import {Buffer} from '../bytes.js';
import {records} from '../arena-core.js';
import type {Allocation,Snapshot} from './indexer.js';
export type OfferStatus='ACTIVE'|'WON / LOCKED'|'BAKED'|'FINISHED'|'CANCELLED';
export function allocationStatus(a:Allocation):OfferStatus {return a.withdrawal?'FINISHED':a.mature?'BAKED':'WON / LOCKED';}
/** Canonical records, including cancelled/exhausted slots, are never inferred from journals. */
export function ownedOffers(snapshot:Snapshot,owner:string){
 if(!/^(02|03)[a-f0-9]{64}$/.test(owner))return [];
 return records(Buffer.from(snapshot.instance.state),false).filter(r=>r.owner===owner).map(record=>{
  const allocations=snapshot.allocations.filter(a=>{const terms=Buffer.from(a.terms);return terms.subarray(0,33).toString('hex')===owner&&terms[65]===record.slot;});
  const refundPending=!!snapshot.offerHistory?.some(h=>h.slot===record.slot&&h.action===4&&h.pending);
  const recovery=record.cancelled&&(!record.refunded||refundPending)&&record.wins<record.maxWins;
  const active=!record.cancelled&&!record.refunded&&record.wins<record.maxWins;
  // Partial legacy allocations retain their independent accounting and actions.
  const status:OfferStatus=active?'ACTIVE':allocations.some(a=>!a.withdrawal)?allocations.some(a=>!a.withdrawal&&a.mature)?'BAKED':'WON / LOCKED':record.wins>0&&allocations.length===record.wins?'FINISHED':record.cancelled&&record.refunded&&!refundPending?'CANCELLED':record.wins>0?'WON / LOCKED':'ACTIVE';
  return {record,allocations,recovery,status};
 });
}

/** Shared UI preflight. The wallet independently repeats ownership and consensus checks. */
export function offerActionIntent(snapshot:Snapshot,owner:string,slot:number,allocation?:string){
 const row=ownedOffers(snapshot,owner).find(o=>o.record.slot===slot);
 if(!row)throw Error('Offer is not owned by the selected wallet.');
 if(allocation){const a=row.allocations.find(a=>a.id===allocation);if(!a||!a.mature||a.withdrawal||a.pending)throw Error('Allocation unavailable or not yet mature on the blockchain.');return {operation:'withdraw',config:snapshot.config,allocation};}
 if(snapshot.pending.length||snapshot.offerHistory?.some(h=>h.slot===slot&&h.pending))throw Error('Cancellation / recovery pending; wait for canonical confirmation before continuing.');
 if(row.recovery)return {operation:'action',config:snapshot.config,action:4,slot};
 if(row.status!=='ACTIVE'||row.record.cancelled||row.record.refunded)throw Error('Only active offers may be cancelled.');
 return {operation:'action',config:snapshot.config,action:1,slot};
}
