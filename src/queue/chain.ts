import {hexToBin,binToHex} from '@bitauth/libauth';
import type {ElectrumCore} from '../electrum-core.js';
import {utxo,json} from '../arena-core.js';
import {verifiedProviders} from '../verified-providers.js';
import {walletPeers,verifyCoins} from '../electrum-wallet.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {arena,node,root,gate,allocation,readState,readNode,CARRIER,ZERO,sameLink,type Parameters,type Identity,type Offer,type Context} from './protocol.js';
import {authenticateGenesis,snapshot,type Anchor} from './indexer.js';
export interface Config {parameters:Parameters;identity:Identity;anchor:Anchor}
export class QueueIndexer {
 constructor(readonly provider:ElectrumCore,readonly config:Config){}
 context(provider=this.provider):Context{return {p:this.config.parameters,identity:this.config.identity,provider};}
 /** Authenticate the immutable category origin within the caller's pinned provider session. */
 async authenticateOrigin(p:ElectrumCore,ancestry:ReturnType<typeof ancestryVerifier>){
  const created=await ancestry(this.config.anchor.genesis),sources=[];
  for(const i of created.vin)sources.push(utxo(await ancestry(i.txid),i.vout));
  authenticateGenesis(this.context(p),this.config.anchor,created.hex,sources);
 }
 /** Read reported outpoints for routing. Only the spend path authorizes a plan. */
 private async queueRows(p:ElectrumCore){
  const c=this.context(p);
  const groups=await Promise.all([arena(c),node(c),root(c)].map(contract=>p.reportedUtxosForLockingBytecode(contract.lockingBytecode)));
  return groups.flat().filter(u=>u.token?.category===c.identity.vault||u.token?.category===c.identity.queue);
 }
 reportedQueue(){
  const p=this.provider;
  return p.session(async()=>{
   const [tip,rows]=await Promise.all([p.tip(),this.queueRows(p)]);
   return {...snapshot(this.context(p),rows),tip};
  });
 }
 private async headRows(p:ElectrumCore){
  const c=this.context(p);
  const [states,nodes]=await Promise.all([arena(c),node(c)].map(contract=>p.reportedUtxosForLockingBytecode(contract.lockingBytecode)));
  const vaults=states.filter(u=>u.token?.category===c.identity.vault);
  if(vaults.length!==1)throw Error('Vault uniqueness failure');
  const vault=vaults[0]!,state=readState(c,vault);
  if(state.head.id===ZERO)throw Error('Queue is empty');
  const candidates=nodes.filter(u=>u.token?.category===c.identity.queue&&u.token.nft?.commitment.slice(0,64)===state.head.id);
  if(candidates.length!==1)throw Error('Head uniqueness failure');
  const first=candidates[0]!;
  if(!sameLink(state.head,readNode(c,first)))throw Error('Stale head score');
  return {vault,node:first,state};
 }
 reportedHead(){
  const p=this.provider;
  return p.session(async()=>{
   const tip=await p.tip();
   const [head,mtp]=await Promise.all([this.headRows(p),p.medianTime(tip.height,tip.hash)]);
   return {...head,clock:{height:tip.height,hash:tip.hash,mtp}};
  });
 }
 async head(){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip);
  const head=await this.headRows(p);
  await verifyCoins(p,[head.vault,head.node],peer,true,(source,ancestry)=>this.authenticateOrigin(source,ancestry));
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during head verification');
  const value={...head,clock:{height:tip.height,hash:tip.hash,mtp,...ticks}};
  return {value,tip,identity:json(value)};
 },{parallel:true});}
 async sync(){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip();
  const coins=await this.queueRows(p),value=snapshot(c,coins);
  const clock=await verifyCoins(p,coins,peer,true,(source,ancestry)=>this.authenticateOrigin(source,ancestry));
  if(clock.hash!==tip.hash)throw Error('Tip changed during queue verification');
  const result={...value,config:this.config,clock:{height:tip.height,hash:tip.hash,mtp:clock.mtp,activationHeight:clock.activationHeight,nextBlockTicks:clock.nextBlockTicks},state:readState(c,value.vault)};
  return {value:result,tip,identity:json({tip:tip.hash,coins:coins.sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout))})};
 },{parallel:true});}
 private async gateSource(p:ElectrumCore,amount:bigint,id?:string){
  const coins=await p.reportedUtxosForLockingBytecode(gate(this.context(p),id).lockingBytecode);
  // Identical donations are interchangeable. Immutable empty NFTs are
  // introspection-indistinguishable from pure FTs in an adversarial escrow.
  const category=id?this.config.parameters.stakingCategory:this.config.parameters.rewardCategory;
  const candidates=coins.filter(u=>(!u.token?.nft||u.token.nft.capability==='none'&&u.token.nft.commitment==='')&&u.token?.category===category&&u.token.amount===amount&&u.satoshis===CARRIER).sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout));
  if(!candidates.length)throw Error('Backed asset gate source unavailable');
  return candidates[0]!;
 }
 reportedAssetInput(amount:bigint,id?:string){return this.provider.session(()=>this.gateSource(this.provider,amount,id));}
 async assetInput(amount:bigint,id?:string){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const tip=await p.tip(),source=await this.gateSource(p,amount,id);
  await verifyCoins(p,[source],peer,true);
  return {value:source,tip,identity:json(source)};
 },{parallel:true});}
 /** History is only needed for owner archives; claims use the state head and one node. */
 async owned(owner:string,offerId?:string){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),script=node(c).lockingBytecode;
  await this.authenticateOrigin(p,ancestry);
  const history=await p.history(script),all=new Map<string,{offer:Offer;created:string;terminal?:any;allocation?:any}>(),outpoints=new Map<string,string>();
  const transactions=[];
  for(const row of history){
   // A script history remains necessary to locate an unknown allocation by ID.
   // Hash-authenticated raw candidates are hints; only the target lineage needs
   // chain/VM authentication. Browsing the whole owner archive verifies all rows.
   const tx=offerId?await p.transaction(row.tx_hash):await ancestry(row.tx_hash,row);transactions.push({tx,row});
   for(const output of tx.vout){
    if(output.scriptPubKey.hex!==script||output.tokenData?.category!==c.identity.queue||offerId&&output.tokenData?.nft?.commitment.slice(0,64)!==offerId)continue;
    if(offerId)await ancestry(row.tx_hash,row);
    const input=utxo(tx,output.n),o=readNode(c,input);outpoints.set(tx.txid+':'+output.n,o.id);
    if(o.owner===owner&&!all.has(o.id))all.set(o.id,{offer:o,created:tx.txid});
   }
  }
  for(const {tx,row} of transactions){const recreated=new Set(tx.vout.flatMap((o:any)=>o.scriptPubKey.hex===script&&o.tokenData?.category===c.identity.queue?[o.tokenData.nft.commitment.slice(0,64)]:[]));for(const i of tx.vin){const id=outpoints.get(i.txid+':'+i.vout),entry=id?all.get(id):undefined;if(entry&&!recreated.has(id))entry.terminal=await ancestry(row.tx_hash,row);}}
  const values=[];
  for(const [id,entry]of all){const t=entry.terminal;let status:'Waiting'|'Baked'|'Finished'|'Cancelled'='Waiting',maturesAt:number|undefined,locked:ReturnType<typeof utxo>|undefined;
   if(t){if(t.vout[2]?.scriptPubKey.hex===allocation(c,entry.offer).lockingBytecode){status='Baked';locked=utxo(t,2);if(t.confirmations>0){const header=await p.header(t.height);await p.verifyHeaderChain(t.height,tip,new Map([[t.height,header.hash]]));maturesAt=await p.medianTime(Math.max(0,t.height-1),header.parent)+entry.offer.duration;}
     const lockHistory=await p.history(allocation(c,entry.offer).lockingBytecode);for(const h of lockHistory){if(h.tx_hash===t.txid)continue;const spender=await ancestry(h.tx_hash,h);if(spender.vin.some((i:any)=>i.txid===t.txid&&i.vout===2)){status='Finished';break;}}
    }else status='Cancelled';}
   if(offerId&&locked&&maturesAt!==undefined&&status==='Baked')await verifyCoins(p,[locked],peer,false);
   values.push({id,...entry,status,maturesAt,locked,checkedMtp:mtp});
  }
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during owner history verification');
  return {value:values,tip,identity:json({tip:tip.hash,values})};
 },{parallel:true});}
}
