import type {Operation} from './wallet.js';
import type {Snapshot} from './indexer.js';

/** Called only with a freshly independently replayed snapshot, never local display data. */
export function reconcileAtomicOffer(op:Operation,snapshot:Snapshot,now=Date.now()):Operation {
 const confirmed=snapshot.history.includes(op.txid!),pending=snapshot.pendingHistory?.includes(op.txid!);
 const conflict=!confirmed&&!pending&&snapshot.instance.inputs[0].txid!==op.source;
 const missing=!confirmed&&!pending&&!conflict;
 const disappeared=missing&&(!!op.verifiedAt||op.stage==='confirmed'||op.observation==='pending'||op.observation==='confirmed'||op.observation==='not-observed'||!!op.acceptedAt&&now-op.acceptedAt>=120000);
 return {...op,step:confirmed||conflict?'complete':'action',stage:confirmed?'confirmed':pending?'pending':conflict?'conflicted':'prepared',
  observation:confirmed?'confirmed':pending?'pending':conflict?'conflicted':disappeared?'not-observed':'propagating',
  verifiedAt:confirmed||pending?now:op.verifiedAt,confirmations:confirmed?1:0,error:confirmed||pending?undefined:conflict?'Competing vault state spend; signed bytes retained':disappeared?'Transaction not observed by verified providers; possibly rejected or evicted. Signed bytes retained.':'Providers have not observed this transaction yet; signed bytes retained'};
}
export function offerDisplayStatus(op:Operation):string {
 if(!op.raw)return op.signing==='rejected'?'Wallet rejected — unsigned operation':'Prepared but not signed';
 if(op.observation==='conflicted'||op.stage==='conflicted')return 'Conflicted — signed evidence retained';
 if(op.observation==='not-observed')return 'Rejected or evicted / no longer observed — signed evidence retained';
 if(op.observation==='unavailable')return 'Verification unavailable — signed evidence retained'+(op.acceptedAt?' (broadcast previously accepted)':' (broadcast status uncertain)');
 if(op.observation==='confirmed'||op.stage==='confirmed')return 'Confirmed at last independent verification';
 if(op.observation==='pending')return 'Independently verified pending (0-conf) at last check — awaiting queue refresh';
 if(op.acceptedAt||op.stage==='pending')return 'Pending (0-conf) — awaiting on-chain verification. Broadcast accepted, awaiting propagation';
 return 'Signed, broadcast status uncertain — signed evidence retained';
}
export const OFFER_RETRY_DELAYS=[1000,2000,4000,8000,15000,30000,60000] as const;
