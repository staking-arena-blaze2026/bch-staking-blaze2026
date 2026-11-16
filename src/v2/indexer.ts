import {tickContext} from '../consensus-clock.js';
import {Buffer} from '../bytes.js';
import {decodeAuthenticationInstructions,binToHex} from '@bitauth/libauth';
import type {ElectrumCore,Header,HistoryEntry} from '../electrum-core.js';
import {walletPeers} from '../electrum-wallet.js';
import {utxo} from '../arena-core.js';
import {hashState} from '../registry.js';
import {advance,covenant,family,initialState,parameterArgs,validateInstance,validateBuilt,termsFor,V2_STATE_SIZE,type Parameters,type Instance} from './protocol.js';
export interface Config extends Parameters {genesis:string}
export interface Allocation {id:string;terms:Buffer;input:ReturnType<typeof utxo>;withdrawal?:string;pending?:string;mature:boolean}
export interface Snapshot {version:2;config:Config;instance:Instance;tip:Header;clock:{height:number;mtp:number;nextBlockTicks?:number};pending:string[];allocations:Allocation[];history:string[];endpoint:string}
function witness(hex:string){const pushes=decodeAuthenticationInstructions(Buffer.from(hex,'hex')).map(i=>{if('data'in i&&i.data)return Buffer.from(i.data);if(i.opcode===0)return Buffer.alloc(0);if(i.opcode>=81&&i.opcode<=96)return Buffer.from([i.opcode-80]);throw Error('Malformed v2 witness');});if(pushes.length!==6||pushes[4]!.length!==V2_STATE_SIZE)throw Error('Invalid v2 witness layout');const num=(b:Buffer)=>{if(b.length>1||(b[0]??0)>127)throw Error('Invalid v2 action/slot');return b[0]??0;};return {state:pushes[4]!,action:num(pushes[3]!),slot:num(pushes[2]!),record:pushes[1]!};}
const identity=(s:Snapshot)=>JSON.stringify({tip:s.tip.hash,state:s.instance.inputs[0].txid,witness:hashState(s.instance.state),pending:[...s.pending].sort(),allocations:s.allocations.map(a=>[a.id,a.withdrawal,a.pending])});
/** Full replay per synchronization: a removed block never leaves a trusted cached state.
 * ElectrumCore supplies bounded reads, transaction proofs, linked headers and chain identity.
 * Pending transactions block actions but never alter confirmed balances or maturity.
 */
export class AssetIndexer {
 snapshot?:Snapshot;error?:string;private busy=false;
 constructor(readonly electrum:ElectrumCore,readonly config:Config){}
 async sync(){if(this.busy)throw Error('V2 synchronization already running');this.busy=true;try{
  const peers=walletPeers(this.electrum);
  const one=await this.electrum.session(()=>this.replay(),peers[0]);
  const two=await this.electrum.session(()=>this.replay(),peers[1]);
  if(identity(one)!==identity(two))throw Error('V2 providers disagree');this.snapshot=two;this.error=undefined;return two;
 }catch(e){this.snapshot=undefined;this.error=String(e);throw e;}finally{this.busy=false;}}
 private async replay():Promise<Snapshot>{
  const e=this.electrum,c=this.config,tip=await e.tip(),clock={height:tip.height,mtp:await e.medianTime(tip.height,tip.hash),...await tickContext(e,tip)},proofs=new Map<number,string>(),pending=new Set<string>(),allocations:Allocation[]=[],cache=new Map<string,any>();
  const rawRead=async(id:string)=>{if(!cache.has(id))cache.set(id,await e.transaction(id));return cache.get(id);};
  const confirm=async(id:string,history:HistoryEntry[])=>{const entry=history.find(h=>h.tx_hash===id);if(!entry||entry.height<=0)throw Error('V2 requires confirmed canonical genesis/history');const tx=await e.transaction(id,entry.height);if(proofs.has(entry.height)&&proofs.get(entry.height)!==tx.blockhash)throw Error('Inconsistent proof header');proofs.set(entry.height,tx.blockhash);cache.set(id,tx);return tx;};
  const verify=async(tx:any)=>{const inputs=[];for(const i of tx.vin)inputs.push(utxo(await rawRead(i.txid),i.vout));validateBuilt(tx.hex,inputs,clock);};
  const genesisRaw=await rawRead(c.genesis);if(genesisRaw.vin.length!==2||genesisRaw.vin[0].vout!==0)throw Error('Invalid v2 genesis layout');
  const category=genesisRaw.vin[0].txid,cs=family(c,category,e),history=await e.history(cs.registry.lockingBytecode),genesis=await confirm(c.genesis,history),factory=utxo(await rawRead(category),0);
  if(factory.lockingBytecode!==covenant('RegistryGenesisV2',parameterArgs(c),e).lockingBytecode)throw Error('Unpinned v2 genesis');await verify(genesis);
  let instance:Instance={parameters:c,category,state:initialState(c),inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};validateInstance(instance,e);
  const ids=[c.genesis],confirmed=history.filter(h=>h.height>0&&h.tx_hash!==c.genesis),transactions=[];
  for(const h of confirmed){const tx=await confirm(h.tx_hash,history);if(tx.vout[0]?.tokenData?.category===category&&tx.vout[0]?.tokenData?.nft?.capability==='mutable')transactions.push(tx);}
  for(;;){const children=transactions.filter(tx=>tx.vin.some((i:any)=>i.txid===instance.inputs[0].txid&&i.vout<3));if(!children.length)break;if(children.length!==1)throw Error('Competing confirmed v2 spends');const tx=children[0];
   for(let n=0;n<3;n++)if(tx.vin[n]?.txid!==instance.inputs[n]!.txid||tx.vin[n].vout!==n)throw Error('V2 paired lineage broken');
   const w=witness(tx.vin[0].scriptSig.hex);if(!w.state.equals(instance.state))throw Error('V2 state witness mismatch');await verify(tx);const next=advance(w.state,w.action,w.slot,w.record);
   if(w.action===3){const terms=termsFor(instance,w.slot),input=utxo(tx,4),a=covenant('StakeAllocationV2',[terms],e);if(input.lockingBytecode!==a.lockingBytecode)throw Error('V2 allocation identity mismatch');allocations.push({id:tx.txid+':4',terms,input,mature:clock.mtp>terms.readUInt32LE(74)});}
   instance={...instance,state:next,inputs:[utxo(tx,0),utxo(tx,1),utxo(tx,2)]};validateInstance(instance,e);ids.push(tx.txid);
  }
  if(ids.length!==transactions.length+1)throw Error('Unrelated confirmed registry history');
  for(const script of [cs.registry.lockingBytecode,cs.escrow.lockingBytecode,cs.reserve.lockingBytecode])for(const h of await e.history(script))if(h.height<=0){const tx=await rawRead(h.tx_hash);if(tx.vin.some((i:any)=>instance.inputs.some(u=>u.txid===i.txid&&u.vout===i.vout)))pending.add(h.tx_hash);}
  for(const a of allocations){const script=a.input.lockingBytecode!;for(const h of await e.history(script)){if(h.tx_hash===a.input.txid)continue;const tx=await rawRead(h.tx_hash);if(!tx.vin.some((i:any)=>i.txid===a.input.txid&&i.vout===4))continue;if(h.height<=0)a.pending=h.tx_hash;else {const confirmed=await confirm(h.tx_hash,[h]);await verify(confirmed);if(a.withdrawal)throw Error('Duplicate allocation spend');a.withdrawal=h.tx_hash;}}}
  await e.verifyHeaderChain(Math.min(...proofs.keys()),tip,proofs);if((await e.tip()).hash!==tip.hash)throw Error('V2 tip changed during replay');
  return {version:2,config:c,instance,tip,clock,pending:[...pending],allocations,history:ids,endpoint:e.endpoint};
 }
}
