import {scriptHash,type ElectrumCore,type Header} from '../electrum-core.js';
import {utxo,json} from '../arena-core.js';
import {boundedMap} from '../bounded-map.js';
import {verifiedProviders} from '../verified-providers.js';
import {walletPeers,verifyCoins,coinIdentity} from '../electrum-wallet.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {arena,node,root,gate,allocation,readState,readNode,CARRIER,ZERO,sameLink,type Parameters,type Identity,type Offer,type Context} from './protocol.js';
import {authenticateGenesis,snapshot,type Anchor,type Snapshot} from './indexer.js';
export interface Config {parameters:Parameters;identity:Identity;anchor:Anchor}
export interface ReportedSnapshot extends Snapshot {config:Config;state:ReturnType<typeof readState>;tip:Header;mtp?:number}
type Coin=ReturnType<typeof utxo>;
interface OwnedNode {outpoint:string;offer:Offer}
interface Terminal {status:'Baked'|'Cancelled';locked?:Coin;maturesAt?:number}
export interface ArchiveRow {id:string;offer:Offer;status:'Waiting'|'Baked'|'Cancelled'|'Finished';locked?:Coin;maturesAt?:number;checkedMtp:number;eligible:boolean}
export interface ArchiveCheckpoint {
 scope:string;tip:{hash:string;height:number};
 confirmed:string[];nodes:OwnedNode[];terminals:[string,Terminal][];finished:string[];
}
export class QueueIndexer {
 private display?:{source:string;status:(string|null)[];at:number;value:ReportedSnapshot};
 constructor(readonly provider:ElectrumCore,readonly config:Config){}
 context(provider=this.provider):Context{return {p:this.config.parameters,identity:this.config.identity,provider};}
 /** Authenticate the immutable category origin within the caller's pinned provider session. */
 async authenticateOrigin(p:ElectrumCore,ancestry:ReturnType<typeof ancestryVerifier>){
  const created=await ancestry(this.config.anchor.genesis),sources=[];
  for(const i of created.vin)sources.push(utxo(await ancestry(i.txid),i.vout));
  authenticateGenesis(this.context(p),this.config.anchor,created.hex,sources);
 }
 /** Read reported outpoints for routing. Only the spend path authorizes a plan. */
 private queueScripts(c:Context){return [arena(c),node(c),root(c)].map(contract=>contract.lockingBytecode);}
 private async queueRows(p:ElectrumCore,scripts=this.queueScripts(this.context(p))){
  const groups=await boundedMap(scripts,3,script=>p.reportedUtxosForLockingBytecode(script));
  return groups.flat().filter(u=>u.token?.category===this.config.identity.vault||u.token?.category===this.config.identity.queue);
 }
 reportedQueue(){
  const p=this.provider;
  return p.session(async()=>{
   const [tip,rows]=await Promise.all([p.tip(),this.queueRows(p)]);
   return {...snapshot(this.context(p),rows),tip};
  });
 }
 /** A provisional queue and optional clock from one pinned provider. */
 reportedDisplay(withClock=false,checkChanges=false){
  const p=this.provider;
  return p.session(()=>this.readReportedDisplay(p,withClock,checkChanges));
 }
 private async readReportedDisplay(p:ElectrumCore,withClock:boolean,checkChanges:boolean):Promise<ReportedSnapshot>{
  const c=this.context(p),scripts=this.queueScripts(c);
  const statuses=()=>boundedMap(scripts,3,async script=>{
   const status=await p.request('blockchain.scripthash.subscribe',scriptHash(script));
   if(status!==null&&(typeof status!=='string'||!/^[a-f0-9]{64}$/.test(status)))throw Error('Invalid Electrum script status');
   return status as string|null;
  });
  const [tip,status]=await Promise.all([p.tip(),checkChanges?statuses().catch(()=>undefined):undefined]);
  const cached=this.display;
  const reusable=cached&&cached.source===p.endpoint&&cached.value.tip.hash===tip.hash&&status&&
   status.every((value,i)=>value===cached.status[i])&&Date.now()-cached.at<120000;
  const value=reusable?cached.value:snapshot(c,await this.queueRows(p,scripts));
  const mtp=withClock?await p.medianTime(tip.height,tip.hash).catch(()=>undefined):undefined;
  const [current,after]=await Promise.all([p.tip(),status&&!reusable?statuses():undefined]);
  if(current.hash!==tip.hash)throw Error('Tip changed during queue read');
  if(after?.some((entry,i)=>entry!==status?.[i]))throw Error('Queue changed during read');
  const result={...value,config:this.config,state:readState(c,value.vault),tip,mtp};
  if(after)this.display={value:result,at:Date.now(),source:p.endpoint,status:after};
  return result;
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
 private async claimAllocation(p:ElectrumCore,owner:string,id:string,claimTxid:string,load:(id:string)=>Promise<any>){
  const c=this.context(p),claim=await load(claimTxid),[controller,claimed]=claim.vin;
  if(!controller||!claimed)throw Error('Missing claim inputs');
  const offer=readNode(c,utxo(await load(claimed.txid),claimed.vout));
  const state=readState(c,utxo(await load(controller.txid),controller.vout));
  if(offer.owner!==owner||offer.id!==id||!sameLink(state.head,offer))throw Error('Claim does not spend the owned queue head');
  const locked=utxo(claim,2);
  if(locked.lockingBytecode!==allocation(c,offer).lockingBytecode)throw Error('Expected stake allocation unavailable');
  return {offer,locked};
 }
 reportedWithdrawal(owner:string,id:string,claimTxid:string){
  const p=this.provider;
  return p.session(async()=>{
   const tip=await p.tip(),entry=await this.claimAllocation(p,owner,id,claimTxid,txid=>p.transaction(txid));
   const live=await p.reportedUtxosForLockingBytecode(entry.locked.lockingBytecode!);
   if(!live.some(coin=>coinIdentity(coin)===coinIdentity(entry.locked)))throw Error('Stake allocation is unavailable or already withdrawn');
   return {...entry,tip};
  });
 }
 async authenticateWithdrawal(p:ElectrumCore,ancestry:ReturnType<typeof ancestryVerifier>,owner:string,id:string,source:Coin){
  await this.authenticateOrigin(p,ancestry);
  const {locked}=await this.claimAllocation(p,owner,id,source.txid,ancestry);
  if(coinIdentity(locked)!==coinIdentity(source))throw Error('Source-output proof mismatch for stake allocation');
 }
 /** Reuse only confirmed history anchored to a block on the current branch. */
 async archive(owner:string,previous?:ArchiveCheckpoint){
  const scope=json({network:this.provider.network,config:this.config,owner});
  return verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{
   const c=this.context(p),script=node(c).lockingBytecode,tip=await p.tip();
   const [mtp,ticks,history]=await Promise.all([p.medianTime(tip.height,tip.hash),tickContext(p,tip),p.history(script)]);
   const ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks},tip);
   const confirmed=history.filter(row=>row.height>0).map(row=>row.tx_hash+':'+row.height).sort();
   let base:ArchiveCheckpoint|undefined;
   if(previous?.scope===scope&&previous.tip.height<=tip.height&&
     json(previous.confirmed)===json(confirmed.filter(row=>Number(row.slice(65))<=previous.tip.height))){
    const anchor=await p.header(previous.tip.height);
    if(anchor.hash===previous.tip.hash){
     if(anchor.hash!==tip.hash)await p.verifyHeaderChain(anchor.height,tip,new Map([[anchor.height,anchor.hash]]));
     base=previous;
    }
   }
   if(!base)await this.authenticateOrigin(p,ancestry);
   const prior=new Set(base?.confirmed),nodes=new Map((base?.nodes??[]).map(entry=>[entry.outpoint,entry.offer]));
   const settledNodes=[...(base?.nodes??[])],terminals=new Map(base?.terminals),settledTerminals=new Map(base?.terminals);
   const transactions=await boundedMap(history.filter(row=>!prior.has(row.tx_hash+':'+row.height)),4,async row=>({row,tx:await p.transaction(row.tx_hash)}));
   // Collect owned outpoints before matching inputs. Electrum may order mempool
   // transactions or same-block rows differently on different servers.
   for(const {row,tx} of transactions){
    for(const output of tx.vout){
     if(output.scriptPubKey.hex!==script||output.tokenData?.category!==c.identity.queue)continue;
     const offer=readNode(c,utxo(tx,output.n));
     if(offer.owner!==owner)continue;
     await ancestry(row.tx_hash,row);
     const outpoint=tx.txid+':'+output.n;
     nodes.set(outpoint,offer);
     if(row.height>0)settledNodes.push({outpoint,offer});
    }
   }
   for(const {row,tx} of transactions){
    const recreated=new Set(tx.vout.filter((o:{n:number})=>nodes.has(tx.txid+':'+o.n))
     .map((o:{n:number})=>nodes.get(tx.txid+':'+o.n)!.id));
    for(const input of tx.vin){
     const offer=nodes.get(input.txid+':'+input.vout);
     if(!offer||recreated.has(offer.id))continue;
     if(terminals.has(offer.id))throw Error('Conflicting unconfirmed offer transitions');
     const terminal=await ancestry(row.tx_hash,row);
     const claim=terminal.vout[2]?.scriptPubKey.hex===allocation(c,offer).lockingBytecode;
     const value:Terminal=claim?{status:'Baked',locked:utxo(terminal,2)}:{status:'Cancelled'};
     if(claim&&row.height>0){
      const block=await p.header(row.height);
      value.maturesAt=await p.medianTime(row.height-1,block.parent)+offer.duration;
     }
     terminals.set(offer.id,value);
     if(row.height>0)settledTerminals.set(offer.id,value);
    }
   }
   const settledFinished=new Set(base?.finished),rows:ArchiveRow[]=[];
   const offers=new Map([...nodes.values()].map(offer=>[offer.id,offer]));
   for(const [id,offer] of [...offers].sort(([a],[b])=>a.localeCompare(b))){
    const terminal=terminals.get(id),locked=terminal?.locked,maturesAt=terminal?.maturesAt;
    let status:ArchiveRow['status']=terminal?.status??'Waiting',eligible=false;
    if(locked){
     if(settledFinished.has(id))status='Finished';
     else {
      for(const h of await p.history(locked.lockingBytecode!)){
       if(h.tx_hash===locked.txid)continue;
       const candidate=await p.transaction(h.tx_hash);
       if(!candidate.vin.some((input:{txid:string;vout:number})=>input.txid===locked.txid&&input.vout===locked.vout))continue;
       await ancestry(h.tx_hash,h);
       if(status==='Finished')throw Error('Conflicting unconfirmed allocation withdrawals');
       status='Finished';
       if(h.height>0&&maturesAt!==undefined)settledFinished.add(id);
      }
      if(status==='Baked'&&maturesAt!==undefined&&mtp>=maturesAt){
       const coins=await p.reportedUtxosForLockingBytecode(locked.lockingBytecode!);
       eligible=coins.some(coin=>coinIdentity(coin)===coinIdentity(locked));
      }
     }
    }
    rows.push({id,offer,status,locked,maturesAt,checkedMtp:mtp,eligible});
   }
   const movement=await p.classifyTipChange(tip);
   if(movement==='reorg')throw Error('Reorganization during owner history verification');
   if(movement!=='same')throw Error('Tip changed during owner history verification');
   const checkpoint:ArchiveCheckpoint={scope,tip:{hash:tip.hash,height:tip.height},confirmed,
    nodes:settledNodes.sort((a,b)=>a.outpoint.localeCompare(b.outpoint)),
    terminals:[...settledTerminals].sort(([a],[b])=>a.localeCompare(b)),finished:[...settledFinished].sort()};
   const value={rows,checkpoint};
   // A live node can change its successor without changing the owner's terms.
   // Canonicalize that display-irrelevant field for agreement on archive rows.
   return {value,tip,identity:json({checkpoint,rows:rows.map(({offer,...row})=>({...row,offer:{...offer,next:undefined}}))})};
  },{parallel:true});
 }
 /** Compatibility for a withdrawal request saved without its claim transaction ID. */
 async owned(owner:string,offerId?:string){
 if(!offerId)return (await this.archive(owner)).rows;
 return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),script=node(c).lockingBytecode;
  await this.authenticateOrigin(p,ancestry);
  const history=await p.history(script),all=new Map<string,{offer:Offer;created:string;terminal?:any;allocation?:any}>(),outpoints=new Map<string,string>();
  const transactions=[];
  for(const row of history){
   // Resolving an older journal requires locating the allocation once by ID.
   const tx=await p.transaction(row.tx_hash);transactions.push({tx,row});
   for(const output of tx.vout){
    if(output.scriptPubKey.hex!==script||output.tokenData?.category!==c.identity.queue||output.tokenData?.nft?.commitment.slice(0,64)!==offerId)continue;
    await ancestry(row.tx_hash,row);
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
   const eligible=!!locked&&maturesAt!==undefined&&status==='Baked'&&mtp>=maturesAt;
   if(eligible&&locked)await verifyCoins(p,[locked],peer,false);
   values.push({id,offer:entry.offer,status,maturesAt,locked,checkedMtp:mtp,eligible});
  }
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during owner history verification');
  return {value:values,tip,identity:json({tip:tip.hash,values})};
 },{parallel:true});}
}
