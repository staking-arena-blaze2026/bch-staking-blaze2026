import {tickContext} from '../consensus-clock.js';
import {timed} from '../operation-timing.js';
import {verifiedProviders} from '../verified-providers.js';
import {ancestryVerifier} from '../zero-conf.js';
import {v3Network} from './network.js';
import {Buffer} from '../bytes.js';
import {decodeAuthenticationInstructions,binToHex} from '@bitauth/libauth';
import type {ElectrumCore,Header,HistoryEntry} from '../electrum-core.js';
import {walletPeers,coinIdentity} from '../electrum-wallet.js';
import {utxo} from '../arena-core.js';
import {hashState} from '../registry.js';
import {validateGenesis,advance,covenant,family,initialState,validateInstance,validateBuilt,termsFor,V3_STATE_SIZE,type Parameters,type Instance} from './protocol.js';
export interface Config extends Parameters {genesis:string}
export interface Allocation {id:string;terms:Buffer;input:ReturnType<typeof utxo>;withdrawal?:string;pending?:string;mature:boolean;sourceMtp:number}
export interface Snapshot {version:3;config:Config;instance:Instance;tip:Header;clock:{height:number;mtp:number;nextBlockTicks?:number};pending:string[];provisional?:boolean;pendingHistory?:string[];ancestry?:string[];allocations:Allocation[];history:string[];endpoint:string}
function witness(hex:string){const pushes=decodeAuthenticationInstructions(Buffer.from(hex,'hex')).map(i=>{if('data'in i&&i.data)return Buffer.from(i.data);if(i.opcode===0)return Buffer.alloc(0);if(i.opcode>=81&&i.opcode<=96)return Buffer.from([i.opcode-80]);throw Error('Malformed v3 witness');});if(pushes.length!==6||pushes[4]!.length!==V3_STATE_SIZE)throw Error('Invalid v3 witness layout');const num=(b:Buffer)=>{if(b.length>1||(b[0]??0)>127)throw Error('Invalid v3 action/slot');return b[0]??0;};return {state:pushes[4]!,action:num(pushes[3]!),slot:num(pushes[2]!),record:pushes[1]!};}
const identity=(s:Snapshot)=>JSON.stringify({tip:s.tip.hash,state:s.instance.inputs[0].txid,witness:hashState(s.instance.state),pending:[...s.pending].sort(),pendingHistory:[...(s.pendingHistory??[])].sort(),provisional:s.provisional,ancestry:s.ancestry,allocations:s.allocations.map(a=>[a.id,a.withdrawal,a.pending])});
/** Replay evidence is reusable only with unchanged peer, tip, histories and live outputs.
 * A removed block never leaves an authorized cached state.
 * ElectrumCore supplies bounded reads, transaction proofs, linked headers and chain identity.
 * Verified pending lineage is replayed provisionally. Pending allocations never gain maturity.
 */
function cloneSnapshot(s:Snapshot):Snapshot {const copy=structuredClone(s);copy.instance.state=Buffer.from(copy.instance.state);for(const a of copy.allocations)a.terms=Buffer.from(a.terms);return copy;}
const replayEvidence=new WeakMap<ElectrumCore,Map<string,{snapshot:Snapshot;histories:Map<string,string>}>>();
const historyIdentity=(rows:HistoryEntry[])=>JSON.stringify([...rows].sort((a,b)=>a.tx_hash.localeCompare(b.tx_hash)));
export class AssetIndexer {
 snapshot?:Snapshot;error?:string;private busy=false;
 constructor(readonly electrum:ElectrumCore,readonly config:Config,readonly onProfile?:(phase:string,ms:number)=>void){v3Network(electrum);}
 async sync(onDisplay?:(snapshot:Snapshot)=>void){if(this.busy)throw Error('V3 synchronization already running');this.busy=true;try{
  const result=await verifiedProviders(this.electrum,walletPeers(this.electrum),async(_peer,source)=>{
   const value=await timed(source,'vault-state-replay',()=>this.replay(source));return {value,tip:value.tip,identity:identity(value)};
  },{parallel:true,onCandidate:onDisplay?value=>onDisplay(cloneSnapshot(value)):undefined});this.snapshot=result;this.error=undefined;return result;
 }catch(e){this.error=String(e);throw e;}finally{this.busy=false;}}
 private async replay(source=this.electrum):Promise<Snapshot>{
  const started=performance.now();
  const e=source,c=this.config,tip=await e.tip(),clock={height:tip.height,mtp:await e.medianTime(tip.height,tip.hash),...await tickContext(e,tip)},proofs=new Map<number,string>(),pending=new Set<string>(),allocations:Allocation[]=[],cache=new Map<string,any>(),pendingHistory:string[]=[];
  const configKey=JSON.stringify(c,(_,v)=>typeof v==='bigint'?v.toString():v),entries=replayEvidence.get(e)??new Map<string,{snapshot:Snapshot;histories:Map<string,string>}>();replayEvidence.set(e,entries);
  const saved=entries.get(configKey),histories=new Map<string,Promise<HistoryEntry[]>>();
  const historyRead=(script:string)=>{let read=histories.get(script);if(!read){read=e.history(script);histories.set(script,read);}return read;};
  // Confirmed replay evidence can survive only this exact peer/tip/config, with
  // every relevant history and current output freshly checked. Pending ancestry
  // is always replayed, even if two providers still advertise the same tip.
  if(saved&&saved.snapshot.tip.hash===tip.hash&&saved.snapshot.endpoint===e.endpoint){
   const checks=await Promise.all([...saved.histories].map(async([script,identity])=>historyIdentity(await historyRead(script))===identity));
   if(checks.every(Boolean)){
    const outputs=await Promise.all(saved.snapshot.instance.inputs.map(async input=>(await e.getUtxosForLockingBytecode(input.lockingBytecode!)).some(u=>coinIdentity(u)===coinIdentity(input))));
    if(!outputs.every(Boolean))throw Error('Current vault output missing, evicted or conflicting');
    if((await e.tip()).hash!==tip.hash)throw Error('V3 tip changed during replay');
    e.onTiming?.({stage:'confirmed-replay-evidence-reused',milliseconds:performance.now()-started,requests:{},ok:true});
    return cloneSnapshot(saved.snapshot);
   }
  }
  this.onProfile?.('clock',performance.now()-started);const genesisStarted=performance.now();
  const ancestry=ancestryVerifier(e,clock);
  const rawRead=async(id:string)=>{if(!cache.has(id))cache.set(id,await e.transaction(id));return cache.get(id);};
  const confirm=async(id:string,history:HistoryEntry[])=>{const entry=history.find(h=>h.tx_hash===id);if(!entry)throw Error('V3 transaction absent from provider history');if(entry.height<=0){const tx=await ancestry(id);cache.set(id,tx);if(!pendingHistory.includes(id))pendingHistory.push(id);return tx;}const tx=await e.transaction(id,entry.height);if(proofs.has(entry.height)&&proofs.get(entry.height)!==tx.blockhash)throw Error('Inconsistent proof header');proofs.set(entry.height,tx.blockhash);cache.set(id,tx);return tx;};
  const verify=async(tx:any)=>{const inputs:ReturnType<typeof utxo>[]=[];for(const i of tx.vin)inputs.push(utxo(await rawRead(i.txid),i.vout));const allocation=allocations.find(a=>a.input.txid===inputs[0]?.txid&&a.input.vout===inputs[0]?.vout);validateBuilt(tx.hex,inputs,clock,allocation?.sourceMtp);};
  const genesisRaw=await rawRead(c.genesis);if(!genesisRaw.vin.length||genesisRaw.vin[0].vout!==0)throw Error('Invalid v3 genesis layout');
  const category=genesisRaw.vin[0].txid,cs=family(c,category,e),history=await historyRead(cs.registry.lockingBytecode),genesis=await confirm(c.genesis,history);
  const genesisInputs=[];for(const i of genesis.vin)genesisInputs.push(utxo(await rawRead(i.txid),i.vout));validateGenesis(c,genesis.hex,genesisInputs,e);await verify(genesis);
  let instance:Instance={parameters:c,category,state:initialState(c),inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};validateInstance(instance,e);
  this.onProfile?.('genesis',performance.now()-genesisStarted);const stateStarted=performance.now();
  const ids=[c.genesis],registryEntries=history.filter(h=>h.tx_hash!==c.genesis),transactions=[];
  for(const h of registryEntries){const tx=await confirm(h.tx_hash,history);if(tx.vout[0]?.tokenData?.category===category&&tx.vout[0]?.tokenData?.nft?.capability==='mutable')transactions.push(tx);}
  for(;;){const children=transactions.filter(tx=>tx.vin.some((i:any)=>i.txid===instance.inputs[0].txid&&i.vout<3));if(!children.length)break;if(children.length!==1)throw Error('Competing v3 spends');const tx=children[0];
   for(let n=0;n<3;n++)if(tx.vin[n]?.txid!==instance.inputs[n]!.txid||tx.vin[n].vout!==n)throw Error('V3 paired lineage broken');
   const w=witness(tx.vin[0].scriptSig.hex);if(!w.state.equals(instance.state))throw Error('V3 state witness mismatch');await verify(tx);const next=advance(w.state,w.action,w.slot,w.record);
   if(w.action===3){const terms=termsFor(instance,w.slot),input=utxo(tx,4),a=covenant('StakeAllocationV3',[terms],e);if(input.lockingBytecode!==a.lockingBytecode)throw Error('V3 allocation identity mismatch');const h=history.find(h=>h.tx_hash===tx.txid)!.height,anchor=await e.header(h>0?h-1:tip.height),sourceMtp=await e.medianTime(anchor.height,anchor.hash);proofs.set(anchor.height,anchor.hash);allocations.push({id:tx.txid+':4',terms,input,sourceMtp,mature:h>0&&clock.mtp>=sourceMtp+(terms.readUInt32LE(74)&65535)*512});}
   instance={...instance,state:next,inputs:[utxo(tx,0),utxo(tx,1),utxo(tx,2)]};validateInstance(instance,e);ids.push(tx.txid);
  }
  if(ids.length!==transactions.length+1)throw Error('Unrelated registry history');
  for(const script of [cs.registry.lockingBytecode,cs.escrow.lockingBytecode,cs.reserve.lockingBytecode])for(const h of script===cs.registry.lockingBytecode?history:await historyRead(script))if(h.height<=0){const tx=await rawRead(h.tx_hash);if(tx.vin.some((i:any)=>instance.inputs.some(u=>u.txid===i.txid&&u.vout===i.vout)))pending.add(h.tx_hash);}
  for(const a of allocations){const script=a.input.lockingBytecode!;for(const h of await historyRead(script)){if(h.tx_hash===a.input.txid)continue;const tx=await rawRead(h.tx_hash);if(!tx.vin.some((i:any)=>i.txid===a.input.txid&&i.vout===4))continue;if(h.height<=0)a.pending=h.tx_hash;else {const confirmed=await confirm(h.tx_hash,[h]);await verify(confirmed);if(a.withdrawal)throw Error('Duplicate allocation spend');a.withdrawal=h.tx_hash;}}}
  if(proofs.size)await e.verifyHeaderChain(Math.min(...proofs.keys()),tip,proofs);
  for(const input of instance.inputs)if(!(await e.getUtxosForLockingBytecode(input.lockingBytecode!)).some(u=>u.txid===input.txid&&u.vout===input.vout))throw Error('Current vault output missing, evicted or conflicting');if((await e.tip()).hash!==tip.hash)throw Error('V3 tip changed during replay');
  this.onProfile?.('stateReplay',performance.now()-stateStarted);
  const snapshot:Snapshot={version:3,config:c,instance,tip,clock,pending:[...pending],provisional:pendingHistory.length>0,pendingHistory,ancestry:[...ancestry.evidence].map(([id,tx])=>`${id}:${tx.height??0}:${tx.blockhash??'pending'}`).sort(),allocations,history:ids.filter(id=>!pendingHistory.includes(id)),endpoint:e.endpoint};
  if(!snapshot.provisional&&!snapshot.pending.length){
   const observed=new Map<string,string>();for(const [script,read]of histories)observed.set(script,historyIdentity(await read));
   if(entries.size>=8)entries.delete(entries.keys().next().value!);
   entries.set(configKey,{snapshot:cloneSnapshot(snapshot),histories:observed});
  }
  return snapshot;
 }
}
