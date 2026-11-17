import {hexToBin,binToHex} from '@bitauth/libauth';
import type {ElectrumCore} from '../electrum-core.js';
import {utxo,json} from '../arena-core.js';
import {verifiedProviders} from '../verified-providers.js';
import {walletPeers,verifyCoins} from '../electrum-wallet.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {arena,node,root,gate,allocation,readState,readNode,CARRIER,type Parameters,type Identity,type Offer,type Context} from './protocol.js';
import {authenticateGenesis,snapshot,type Anchor} from './indexer.js';
export interface Config {parameters:Parameters;identity:Identity;anchor:Anchor}
export class QueueIndexer {
 constructor(readonly provider:ElectrumCore,readonly config:Config){}
 context(provider=this.provider):Context{return {p:this.config.parameters,identity:this.config.identity,provider};}
 async sync(){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks});
  const created=await ancestry(this.config.anchor.genesis),sources=[];
  for(const i of created.vin)sources.push(utxo(await ancestry(i.txid),i.vout));
  authenticateGenesis(c,this.config.anchor,created.hex,sources);
  const groups=await Promise.all([arena(c),node(c),root(c)].map(contract=>p.getUtxosForLockingBytecode(contract.lockingBytecode))),coins=groups.flat().filter(u=>u.token?.category===c.identity.vault||u.token?.category===c.identity.queue),value=snapshot(c,coins);
  await verifyCoins(p,coins,peer,true);
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during queue verification');
  const result={...value,config:this.config,clock:{height:tip.height,hash:tip.hash,mtp,...ticks},state:readState(c,value.vault)};
  return {value:result,tip,identity:json({tip:tip.hash,coins:coins.sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout))})};
 },{parallel:true});}
 async assetInput(amount:bigint,id?:string){return verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
  const tip=await p.tip(),coins=await p.getUtxosForLockingBytecode(gate(this.context(p),id).lockingBytecode);
  // Tokenless exhausted reserves are retained. Donations never replace the backed source.
  const category=id?this.config.parameters.stakingCategory:this.config.parameters.rewardCategory;
  // Immutable empty NFTs are introspection-indistinguishable from pure FTs.
  // Accept these in adversarial escrows so a bidder cannot block the head.
  const candidates=coins.filter(u=>(!u.token?.nft||u.token.nft.capability==='none'&&u.token.nft.commitment==='')&&u.token?.category===category&&u.token.amount===amount&&u.satoshis===CARRIER).sort((a,b)=>(a.txid+':'+a.vout).localeCompare(b.txid+':'+b.vout));
  if(!candidates.length)throw Error('Backed asset gate source unavailable');
  // Identical donations are interchangeable; they cannot block an authentic escrow.
  await verifyCoins(p,[candidates[0]!],peer,true);return {value:candidates[0]!,tip,identity:json(candidates[0])};
 },{parallel:true});}
 /** History is only needed for owner archives; claims use the state head and one node. */
 async owned(owner:string){await this.sync();return verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{
  const c=this.context(p),tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),script=node(c).lockingBytecode;
  const history=await p.history(script),all=new Map<string,{offer:Offer;created:string;terminal?:any;allocation?:any}>(),outpoints=new Map<string,string>();
  const transactions=[];
  for(const row of history){const tx=await ancestry(row.tx_hash,row);transactions.push(tx);for(const output of tx.vout){if(output.scriptPubKey.hex!==script||output.tokenData?.category!==c.identity.queue)continue;const input=utxo(tx,output.n),o=readNode(c,input);outpoints.set(tx.txid+':'+output.n,o.id);if(o.owner===owner&&!all.has(o.id))all.set(o.id,{offer:o,created:tx.txid});}}
  for(const tx of transactions){const recreated=new Set(tx.vout.flatMap((o:any)=>o.scriptPubKey.hex===script&&o.tokenData?.category===c.identity.queue?[o.tokenData.nft.commitment.slice(0,64)]:[]));for(const i of tx.vin){const id=outpoints.get(i.txid+':'+i.vout),entry=id?all.get(id):undefined;if(entry&&!recreated.has(id))entry.terminal=tx;}}
  const values=[];
  for(const [id,entry]of all){const t=entry.terminal;let status:'Waiting'|'Baked'|'Finished'|'Cancelled'='Waiting',maturesAt:number|undefined,locked:ReturnType<typeof utxo>|undefined;
   if(t){if(t.vout[2]?.scriptPubKey.hex===allocation(c,entry.offer).lockingBytecode){status='Baked';locked=utxo(t,2);if(t.confirmations>0)maturesAt=await p.medianTime(Math.max(0,t.height-1))+entry.offer.duration;
     const lockHistory=await p.history(allocation(c,entry.offer).lockingBytecode);for(const h of lockHistory){if(h.tx_hash===t.txid)continue;const spender=await ancestry(h.tx_hash,h);if(spender.vin.some((i:any)=>i.txid===t.txid&&i.vout===2)){status='Finished';break;}}
    }else status='Cancelled';}
   values.push({id,...entry,status,maturesAt,locked,checkedMtp:mtp});
  }
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during owner history verification');
  return {value:values,tip,identity:json({tip:tip.hash,values})};
 },{parallel:true});}
}
