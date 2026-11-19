import {hexToBin,binToHex} from '@bitauth/libauth';
import type {ElectrumCore,Header} from '../electrum-core.js';
import {utxo,json} from '../arena-core.js';
import {verifiedProviders} from '../verified-providers.js';
import {coinIdentity,walletPeers,verifyCoins} from '../electrum-wallet.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {arena,node,root,gate,allocation,readState,readNode,CARRIER,ZERO,sameLink,type Parameters,type Identity,type Offer,type Context} from './protocol.js';
import {compare,emptyLink,type Score} from './model.js';
import {authenticateGenesis,insertionPoint,snapshot,type Anchor} from './indexer.js';
import {policyRate} from './fees.js';
import {boundedMap} from '../bounded-map.js';
export interface Config {parameters:Parameters;identity:Identity;anchor:Anchor}
export class QueueIndexer {
 constructor(readonly provider:ElectrumCore,readonly config:Config){}
 context(provider=this.provider):Context{return {p:this.config.parameters,identity:this.config.identity,provider};}
 /** Authenticate the immutable category origin within the caller's pinned provider session. */
 private async origin(p:ElectrumCore,ancestry:ReturnType<typeof ancestryVerifier>){
  const created=await ancestry(this.config.anchor.genesis),sources=[];
  for(const i of created.vin)sources.push(utxo(await ancestry(i.txid),i.vout));
  authenticateGenesis(this.context(p),this.config.anchor,created.hex,sources);
 }
 /** Local routing over untrusted token-aware listunspent rows. For a quote
  * only inspect ranking boundaries. The verified path also checks reachability. */
 async reportedInsertion(p:ElectrumCore,terms:Score,sessionRows?:Map<string,Coin[]>){
  const c=this.context(p);
  const [vaults,nodes]=await boundedMap([arena(c),node(c)],2,contract=>readCandidates(p,contract.lockingBytecode,sessionRows));
  const states=vaults!.filter(u=>u.token?.category===c.identity.vault);
  if(states.length!==1)throw Error('Vault uniqueness failure');
  const vault=states[0]!,state=readState(c,vault),standing=nodes!.filter(u=>u.token?.category===c.identity.queue);
  const roots=state.head.id===ZERO||sessionRows
   ?(await readCandidates(p,root(c).lockingBytecode,sessionRows)).filter(u=>u.token?.category===c.identity.queue)
   :[];
  if(sessionRows){
   const current=snapshot(c,[vault,...roots,...standing]),position=insertionPoint(current,terms);
   const successor=position.controller===vault?state.head:readNode(c,position.controller).next;
   return {...position,state,vault,successor:current.nodes.get(successor.id)?.utxo};
  }
  if(state.head.id===ZERO){
   if(standing.length||!sameLink(state.head,emptyLink()))throw Error('Malformed empty queue');
   const current=snapshot(c,[vault,...roots]);
   return {state,vault,controller:vault,authority:current.root,successor:undefined};
  }
  if(compare(terms,state.head)>0){
   const candidates=standing.filter(u=>u.token?.nft?.commitment.slice(0,64)===state.head.id),head=candidates[0];
   if(!head||candidates.length!==1||!sameLink(state.head,readNode(c,head)))throw Error('Malformed or stale queue head');
   return {state,vault,controller:vault,authority:head,successor:head};
  }
  const entries=standing.map(utxo=>({utxo,offer:readNode(c,utxo)}));
  const byId=new Map(entries.map(entry=>[entry.offer.id,entry]));
  if(byId.size!==entries.length)throw Error('Duplicate queue membership');
  const linked=(link:Offer['next'])=>{
   if(link.id===ZERO&&sameLink(link,emptyLink()))return undefined;
   const entry=byId.get(link.id);
   if(!entry||!sameLink(link,entry.offer))throw Error('Malformed or stale queue link');
   return entry.utxo;
  };
  linked(state.head);
  const matches=entries.filter(({offer})=>compare(offer,terms)>=0&&(offer.next.id===ZERO||compare(terms,offer.next)>0));
  if(matches.length!==1)throw Error('No unique reported insertion point');
  return {state,vault,controller:matches[0]!.utxo,authority:undefined,successor:linked(matches[0]!.offer.next)};
 }
 async reportedClaim(p:ElectrumCore,tip:Header,sessionRows?:Map<string,Coin[]>){
  const c=this.context(p);
  const [vaults,nodes,mtp]=await readTogether([
   readCandidates(p,arena(c).lockingBytecode,sessionRows),readCandidates(p,node(c).lockingBytecode,sessionRows),p.medianTime(tip.height,tip.hash),
  ]);
  const states=vaults.filter(u=>u.token?.category===c.identity.vault);
  if(states.length!==1)throw Error('Vault uniqueness failure');
  const vault=states[0]!,state=readState(c,vault);
  if(state.head.id===ZERO)throw Error('Queue is empty');
  const candidates=nodes.filter(u=>u.token?.category===c.identity.queue&&u.token.nft?.commitment.slice(0,64)===state.head.id);
  if(candidates.length!==1)throw Error('Head uniqueness failure');
  const first=candidates[0]!,offer=readNode(c,first);
  if(!sameLink(state.head,offer))throw Error('Stale head score');
  const [escrow,reserve]=await readTogether([
   c.p.stakingCategory===ZERO?undefined:this.reportedAsset(p,offer.stake,offer.id,sessionRows),
   c.p.rewardCategory===ZERO||offer.reward>state.reserve?undefined:this.reportedAsset(p,state.reserve,undefined,sessionRows),
  ]);
  return {vault,node:first,state,offer,mtp,escrow,reserve};
 }
 private async reportedAsset(p:ElectrumCore,amount:bigint,id?:string,sessionRows?:Map<string,Coin[]>){
  const coins=await readCandidates(p,gate(this.context(p),id).lockingBytecode,sessionRows);
  return this.selectAsset(coins,amount,id);
 }
 private selectAsset(coins:Awaited<ReturnType<ElectrumCore['getUtxoCandidates']>>,amount:bigint,id?:string){
  const category=id?this.config.parameters.stakingCategory:this.config.parameters.rewardCategory;
  const candidates=coins.filter(u=>(!u.token?.nft||u.token.nft.capability==='none'&&u.token.nft.commitment==='')&&u.token?.category===category&&u.token.amount===amount&&u.satoshis===CARRIER).sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout));
  if(!candidates.length)throw Error('Backed asset gate source unavailable');
  return candidates[0]!;
 }
 private async action<T,P>(read:(p:ElectrumCore,tip:Header,rows:Map<string,Coin[]>)=>Promise<T>,sources:(value:T)=>Coin[],build:(value:T,rate:bigint)=>{value:P;funding:Coin[]},time?:(value:T)=>number){
  // Identical draft inputs only save local transaction construction. Both
  // peers must still authenticate the exact sources in their own session.
  const drafts=new Map<string,{plan?:ReturnType<typeof build>;error?:unknown}>();
  return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p,tip)=>{
   const rows=new Map<string,Coin[]>();
   const [state,rate,mtp,ticks]=await readTogether([
    read(p,tip,rows),p.request('blockchain.relayfee').then(policy=>policyRate(policy)),
    !time?p.medianTime(tip.height,tip.hash):undefined,tickContext(p,tip),
   ]);
   const contracts=sources(state),currentMtp=time?time(state):mtp!;
   const key=json({rate,mtp:currentMtp,contracts:contracts.map(coinIdentity)});
   let draft=drafts.get(key);
   if(!draft){
    try{draft={plan:build(state,rate)};}catch(error){draft={error};}
    drafts.set(key,draft);
   }
   const coins=watchCoins(...contracts,...(draft.plan?.funding??[])),ancestry=ancestryVerifier(p,{height:tip.height,mtp:currentMtp,...ticks},tip);
   // Complete both reads in this session, including on failure.
   const originRead=Promise.allSettled([this.origin(p,ancestry)]);
   const [inputs]=await Promise.allSettled([verifyCoins(p,coins,peer,true,true,tip,originRead,rows)]);
   const [origin]=await originRead;
   if(inputs.status==='rejected')throw inputs.reason;
   if(origin?.status==='rejected')throw origin.reason;
   const value={state,rate,tip:tip.hash,height:tip.height,planned:draft.plan?.value,planError:draft.error};
   return {value,tip,identity:json({tip:tip.hash,coins:coins.map(coinIdentity),ancestry:inputs.value.ancestry,rate,planError:String(draft.error)})};
  },{parallel:true});
 }
 insertion<P>(terms:Score,build:(state:Awaited<ReturnType<QueueIndexer['reportedInsertion']>>,rate:bigint)=>{value:P;funding:Coin[]}){
  return this.action((p,_tip,rows)=>this.reportedInsertion(p,terms,rows),s=>watchCoins(s.vault,s.controller,s.authority,s.successor),build);
 }
 claim<P>(build:(state:Awaited<ReturnType<QueueIndexer['reportedClaim']>>,rate:bigint)=>{value:P;funding:Coin[]}){
  return this.action((p,tip,rows)=>this.reportedClaim(p,tip,rows),s=>watchCoins(s.vault,s.node,s.escrow,s.reserve),build,s=>s.mtp);
 }
 /** Financial head read: no root read, ranking or traversal of the standing queue.
  * listunspent is script-indexed, so the server still returns node candidates. */
 async head(){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks});
  await this.origin(p,ancestry);
  const states=(await p.getUtxosForLockingBytecode(arena(c).lockingBytecode)).filter(u=>u.token?.category===c.identity.vault);
  if(states.length!==1)throw Error('Vault uniqueness failure');
  const vault=states[0]!,state=readState(c,vault);
  if(state.head.id===ZERO)throw Error('Queue is empty');
  const candidates=(await p.getUtxosForLockingBytecode(node(c).lockingBytecode)).filter(u=>u.token?.category===c.identity.queue&&u.token.nft?.commitment.slice(0,64)===state.head.id);
  if(candidates.length!==1)throw Error('Head uniqueness failure');
  const first=candidates[0]!,offer=readNode(c,first);
  if(!sameLink(state.head,offer))throw Error('Stale head score');
  await verifyCoins(p,[vault,first],peer,true);
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during head verification');
  const value={vault,node:first,state,clock:{height:tip.height,hash:tip.hash,mtp,...ticks}};
  return {value,tip,identity:json(value)};
 },{parallel:true});}
 async sync(){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks});
  await this.origin(p,ancestry);
  const groups=await Promise.all([arena(c),node(c),root(c)].map(contract=>p.getUtxosForLockingBytecode(contract.lockingBytecode))),coins=groups.flat().filter(u=>u.token?.category===c.identity.vault||u.token?.category===c.identity.queue),value=snapshot(c,coins);
  await verifyCoins(p,coins,peer,true);
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during queue verification');
  const result={...value,config:this.config,clock:{height:tip.height,hash:tip.hash,mtp,...ticks},state:readState(c,value.vault)};
  return {value:result,tip,identity:json({tip:tip.hash,coins:coins.sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout))})};
 },{parallel:true});}
 async assetInput(amount:bigint,id?:string){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const tip=await p.tip(),coins=await p.getUtxosForLockingBytecode(gate(this.context(p),id).lockingBytecode);
  // Tokenless exhausted reserves are retained. Donations never replace the backed source.
  // Immutable empty NFTs are introspection-indistinguishable from pure FTs.
  // Accept these in adversarial escrows so a bidder cannot block the head.
  const candidate=this.selectAsset(coins,amount,id);
  // Identical donations are interchangeable; they cannot block an authentic escrow.
  await verifyCoins(p,[candidate],peer,true);return {value:candidate,tip,identity:json(candidate)};
 },{parallel:true});}
 /** History is only needed for owner archives; claims use the state head and one node. */
 async owned(owner:string,offerId?:string){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),script=node(c).lockingBytecode;
  await this.origin(p,ancestry);
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
type Coin=Awaited<ReturnType<ElectrumCore['getUtxoCandidates']>>[number];
function watchCoins(...coins:(Coin|undefined)[]){return [...new Set(coins.filter((coin):coin is Coin=>!!coin))];}
async function readCandidates(p:ElectrumCore,script:string,sessionRows?:Map<string,Coin[]>){
 const coins=await p.getUtxoCandidates(script);sessionRows?.set(script,coins);return coins;
}
async function readTogether<const T extends readonly unknown[]>(reads:T):Promise<{[K in keyof T]:Awaited<T[K]>}>{
 const results=await Promise.allSettled(reads);
 return results.map(result=>{
  if(result.status==='rejected')throw result.reason;
  return result.value;
 }) as {[K in keyof T]:Awaited<T[K]>};
}
