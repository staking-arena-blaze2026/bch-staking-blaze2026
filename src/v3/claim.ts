import {v3Storage,type V3Network} from './network.js';
import {Buffer} from '../bytes.js';
import {walletPeers,verifyCoinsAcrossPeers} from '../electrum-wallet.js';
import {AssetIndexer,type Config,type Snapshot} from './indexer.js';
import {FEE,CARRIER,covenant,family,decision,sponsorAmount,transitionBuilder,validateBuilt} from './protocol.js';
/** Public inspection is read-only. The connected caller pays through AssetWallet.claim. */
export async function inspectClaim(index:AssetIndexer){
 const snapshot=await index.sync(),next=decision(snapshot.instance,snapshot.clock),required=sponsorAmount(snapshot.instance,3);
 return {snapshot,next,required,minerFee:FEE,carriers:required-FEE,carrierPerTokenOutput:CARRIER};
}

/** The UI retains legacy donation journals for read-only reconciliation. */
export interface ClaimRecord {id:string;config:Config;source:string;raw:string;status:'prepared'|'pending'|'confirmed'|'conflicted';error?:string}
export interface ClaimStore {list():Promise<ClaimRecord[]>;save(record:ClaimRecord):Promise<void>}
/** Anyone can supply the exact BCH donation. No key, wallet session or keeper is used. */
export class RewardClaimer {
 constructor(readonly index:AssetIndexer,readonly store:ClaimStore){}
 sponsorContract(snapshot:Snapshot){const p=this.index.electrum,cs=family(snapshot.config,snapshot.instance.category,p);return covenant('FeeSponsorV3',[Buffer.from(cs.registry.lockingBytecode,'hex')],p);}
 async inspect(){const snapshot=await this.index.sync(),next=decision(snapshot.instance,snapshot.clock),contract=this.sponsorContract(snapshot);
  const p=this.index.electrum,peer=walletPeers(p)[0];
  const candidates=await p.session(async()=>{const history=await p.history(contract.lockingBytecode),confirmed=new Set(history.filter(h=>h.height>0).map(h=>h.tx_hash));return (await p.getUtxosForLockingBytecode(contract.lockingBytecode)).filter(c=>confirmed.has(c.txid)&&!c.token&&c.satoshis===sponsorAmount(snapshot.instance,3));},peer),sponsor=candidates[0];
  if(sponsor){const verified=await verifyCoinsAcrossPeers(p,[sponsor]);if(verified.hash!==snapshot.tip.hash)throw Error('Chain changed while verifying sponsorship; refresh');}
  return {snapshot,next,sponsor,address:contract.address,required:sponsorAmount(snapshot.instance,3)};
 }
 async claim(){const {snapshot,next,sponsor}=await this.inspect();if(snapshot.pending.length)throw Error('A competing vault transaction is pending');if(next.phase!=='ready')throw Error(next.reason);if(!sponsor)throw Error('Exact public BCH fee sponsorship required');
  const existing=(await this.store.list()).find(r=>r.config.genesis===snapshot.config.genesis&&r.source===snapshot.instance.inputs[0].txid&&(r.status==='prepared'||r.status==='pending'));
  if(existing)return this.reconcile(existing.id,true);
  const p=this.index.electrum,clock=await verifyCoinsAcrossPeers(p,[...snapshot.instance.inputs,sponsor],true);
  if(clock.hash!==snapshot.tip.hash)throw Error('Chain changed; refresh before claiming');
  const built=transitionBuilder(snapshot.instance,3,next.slot,p,clock,{input:sponsor,unlocker:this.sponsorContract(snapshot).unlock.spend()}),raw=built.builder.build(),checked=validateBuilt(raw,built.sources,clock);
  const record:ClaimRecord={id:checked.txid,config:snapshot.config,source:snapshot.instance.inputs[0].txid,raw,status:'prepared'};
  await this.store.save(record);
  try{await p.session(()=>p.sendRawTransaction(raw),clock.peer);record.status='pending';}catch(e){record.error=String(e);}
  await this.store.save(record);return record;
 }
 /** Reconcile the same bytes. An uncertain broadcast never allocates fresh sponsor coins. */
 async reconcile(id:string,retry=false){const record=(await this.store.list()).find(r=>r.id===id);if(!record)throw Error('Unknown claim');const snapshot=await this.index.sync();
  record.status=snapshot.history.includes(id)?'confirmed':(snapshot.pending.includes(id)||(snapshot.pendingHistory??[]).includes(id))?'pending':snapshot.instance.inputs[0].txid!==record.source?'conflicted':'prepared';
  if(retry&&record.status==='prepared'){try{await this.index.electrum.session(()=>this.index.electrum.sendRawTransaction(record.raw),walletPeers(this.index.electrum)[0]);record.status='pending';record.error=undefined;}catch(e){record.error=String(e);}}
  await this.store.save(record);return record;
 }
}
export class BrowserClaimStore implements ClaimStore {
 constructor(readonly network:V3Network='regtest'){}
 private db?:Promise<IDBDatabase>;
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(v3Storage('claims',this.network),1);r.onupgradeneeded=()=>r.result.createObjectStore('claims');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Claim journal blocked'));});}
 async list(){const db=await this.open();return new Promise<ClaimRecord[]>((resolve,reject)=>{const r=db.transaction('claims').objectStore('claims').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async save(r:ClaimRecord){const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('claims','readwrite',{durability:'strict'});t.objectStore('claims').put(r,r.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}
