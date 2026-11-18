import {placeholderP2PKHUnlocker,placeholderSignature,type SpendableUtxo} from 'cashscript';
import {binToHex,hexToBin,decodeTransaction,hashTransaction,type Transaction} from '@bitauth/libauth';
import type {ElectrumCore} from '../electrum-core.js';
import {verifyCoins,verifyCoinsAcrossPeers,confirmedWalletTransaction,walletPeers} from '../electrum-wallet.js';
import {walletAddress,validateWalletSigned,type WalletKey,type WalletCoin,type BrowserPlan} from '../transactions-core.js';
import {verifiedProviders} from '../verified-providers.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {transactionFinal} from '../consensus-clock.js';
import {validateNewTime} from '../v3/time-policy.js';
import {json} from '../arena-core.js';
import {QueueIndexer,type Config} from './chain.js';
import {insertionPoint,cancellationPoint} from './indexer.js';
import {policyRate} from './fees.js';
import * as q from './protocol.js';
import {creationSequence,type CreationQuote} from './preparation.js';
export type Intent={kind:'create';parameters:q.Parameters}|{kind:'insert';config:Config;terms:q.Score}|{kind:'cancel'|'withdraw';config:Config;offerId:string}|{kind:'claim';config:Config;expectedHead?:string};
export interface Operation {
 id:string;intent:Intent;owner:WalletKey;keys:WalletKey[];stage:'review'|'signed'|'pending'|'confirmed'|'conflict'|'discarded';
 network?:'mainnet'|'chipnet'|'regtest';
 step:'action'|'wallet-preparation';quote?:CreationQuote;completed?:number;spentFees?:string;parent?:string;next?:string;approved?:boolean;reservations?:SpendableUtxo[];plan:BrowserPlan;sources:SpendableUtxo[];rate:bigint;signedEvidence?:string;raw?:string;txid?:string;verifiedAt?:number;error?:string;
 config?:Config;offerId?:string;walletDebit?:string;
 signing:'unsigned'|'requested'|'rejected'|'uncertain'|'signed';
}
export interface Store {list():Promise<Operation[]>;save(op:Operation):Promise<void>}
const outpoint=(u:SpendableUtxo)=>u.txid+':'+u.vout;
/** Plans, public derivation paths and signed bytes are durable; private keys
 * never enter this service. All actions share the same approval/broadcast path. */
export class QueueWallet {
 private readonly reviewed=new Map<string,{seal:string;tip:string}>();
 invalidateReviews(){this.reviewed.clear();}
 private seal(op:Operation){return json({intent:op.intent,owner:op.owner,keys:op.keys,step:op.step,plan:op.plan,sources:op.sources,rate:op.rate,config:op.config,offerId:op.offerId,network:op.network,quote:op.quote,completed:op.completed,spentFees:op.spentFees,parent:op.parent,reservations:op.reservations});}
 constructor(readonly provider:ElectrumCore,readonly store:Store){}
 async get(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op)throw Error('Unknown queue operation');if(op.network&&op.network!==this.network())throw Error('Queue journal network mismatch');if(op.step!=='action'&&op.step!=='wallet-preparation')throw Error('Legacy transaction evidence requires manual inspection');return op;}
 private funding(coin:WalletCoin):q.Funding{return {input:coin.utxo,unlocker:placeholderP2PKHUnlocker(walletAddress(hexToBin(coin.publicKey),this.network()))};}
 private network(){const network=String(this.provider.network);if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported queue network');return network as 'mainnet'|'chipnet'|'regtest';}
 private authorization(owner:WalletKey){return {publicKey:hexToBin(owner.publicKey),authorization:placeholderSignature()};}
 private async rate(){return verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{const tip=await p.tip(),rate=policyRate(await p.request('blockchain.relayfee'));return {value:{rate,tip:tip.hash},tip,identity:tip.hash+':'+rate};});}
 private async inventory(keys:WalletKey[],id:string){
  if(!keys.length||keys.length>600||new Set(keys.map(k=>k.path+':'+k.index)).size!==keys.length)throw Error('Invalid wallet descriptor');
  const coins=await verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
   const tip=await p.tip(),coins:WalletCoin[]=[];
   for(const key of keys){if(!['receive','change','defi'].includes(key.path)||!Number.isInteger(key.index)||key.index<0||key.index>=200)throw Error('Invalid wallet derivation');walletAddress(hexToBin(key.publicKey),this.network());const script=binToHex(q.ownerScript(hexToBin(key.publicKey)));for(const u of await p.getUtxosForLockingBytecode(script))if(!u.token?.nft)coins.push({...key,utxo:u});}
   if(new Set(coins.map(c=>outpoint(c.utxo))).size!==coins.length)throw Error('Duplicate wallet funding');
   await verifyCoins(p,coins.map(c=>c.utxo),peer,true);if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during funding discovery');
   coins.sort((a,b)=>outpoint(a.utxo).localeCompare(outpoint(b.utxo)));return {value:coins,tip,identity:json({tip:tip.hash,coins})};
  },{parallel:true});
  const list=await this.store.list(),reserved=new Set(list.filter(o=>o.id!==id&&!id.startsWith(o.id+':next')&&!['confirmed','discarded','conflict'].includes(o.stage)).flatMap(o=>(o.reservations??o.sources).map(outpoint)));
  return coins.filter(c=>!reserved.has(outpoint(c.utxo))).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1);
 }
 private plan(built:ReturnType<typeof q.priced>,coins:WalletCoin[],owner:WalletKey,authorize:boolean,label:string):BrowserPlan{
  const request=built.builder.generateWcTransactionObject({broadcast:false,userPrompt:label}),inputPaths:BrowserPlan['inputPaths']=[],signers:Record<number,string>={};
  for(const [i,u]of built.sources.entries()){const coin=coins.find(c=>outpoint(c.utxo)===outpoint(u));if(coin){inputPaths.push([i,coin.path,coin.index]);signers[i]=coin.publicKey;}}
  if(authorize){inputPaths.unshift([0,owner.path,owner.index]);signers[0]=owner.publicKey;}
  return {kind:'offer',label,request,inputPaths,signers,fee:built.fee.toString()};
 }
 private select<T>(coins:WalletCoin[],asset:string,amount:bigint,build:(selected:WalletCoin[])=>T,limit=16):T{
  const eligible=coins.filter(c=>!c.utxo.token||asset!==q.ZERO&&c.utxo.token.category===asset),selected:WalletCoin[]=[];
  // Token inputs first, then the fewest largest BCH coins needed for the measured fee.
  eligible.sort((a,b)=>a.utxo.token&&!b.utxo.token?-1:!a.utxo.token&&b.utxo.token?1:a.utxo.satoshis>b.utxo.satoshis?-1:1);
  let tokens=0n,last:unknown;
  for(const coin of eligible){if(selected.length===limit)break;selected.push(coin);tokens+=coin.utxo.token?.amount??0n;if(asset!==q.ZERO&&tokens<amount)continue;try{return build(selected);}catch(e){if(!/Insufficient BCH|dust|minimum|negative|lower than/i.test(String(e)))throw e;last=e;}}
  throw last??Error('Insufficient wallet funding for the selected assets and measured fee');
 }
 async prepare(intent:Intent,keys:WalletKey[],previous?:Operation,continuation?:{id:string;parent:string;completed:number;spentFees:string}):Promise<Operation>{
  if(previous?.network&&previous.network!==this.network())throw Error('Queue journal network mismatch');
  if(previous&&(previous.raw||!['unsigned','rejected'].includes(previous.signing)))throw Error('Uncertain or signed operations cannot be rebuilt');
  if(previous)this.reviewed.delete(previous.id);
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner||previous&&previous.owner.publicKey!==owner.publicKey)throw Error('Resume with the original wallet');
  const id=previous?.id??continuation?.id??crypto.randomUUID(),coins=await this.inventory(keys,id),policy=await this.rate(),rate=policy.rate,authorization=this.authorization(owner);
  let step:Operation['step']='action',built:ReturnType<typeof q.priced>,authorize=true,selected:WalletCoin[]=[],config=previous?.config,offerId=previous?.offerId;let label:string=intent.kind;let quote:CreationQuote|undefined;let reservations:SpendableUtxo[]|undefined;
  if(intent.kind==='create'){
   q.parameters(intent.parameters);
   validateNewTime(intent.parameters.interval,this.network(),'Interval');
   const sequence=creationSequence(intent.parameters,coins,owner,this.provider,rate);quote=sequence.quote;reservations=coins.filter(c=>sequence.preparations.some(s=>s.selected.includes(c))||sequence.selected.includes(c)).map(c=>c.utxo);
   const first=sequence.preparations[0];authorize=false;
   if(first){built=first.built;selected=first.selected;step='wallet-preparation';config=undefined;label='Prepare wallet with a BCH self-send';}
   else {built=sequence.created;selected=sequence.selected;config={parameters:intent.parameters,identity:sequence.created.context.identity,anchor:{genesis:'',creator:owner.publicKey}};label='Create vault with full reward reserve';}
  }else {
   const index=new QueueIndexer(this.provider,intent.config),c=index.context();config=intent.config;
   // Withdrawals are independent of the standing queue; claims need only its head.
   const snapshot=intent.kind==='insert'||intent.kind==='cancel'?await index.sync():undefined;
   const head=intent.kind==='claim'?await index.head():undefined;
   if(intent.kind==='claim'&&intent.expectedHead&&head!.state.head.id!==intent.expectedHead)throw Error('Winning offer changed; review the current head before claiming');
   if(intent.kind==='insert'){
    if(intent.terms.reward>snapshot!.state.reserve)throw Error('Reward request can never be funded by the remaining reserve');
    const position=insertionPoint(snapshot!,intent.terms),inserted=this.select(coins,c.p.stakingCategory,intent.terms.stake,cs=>{const result=q.insert(c,position.controller,position.authority,intent.terms,authorization,cs.map(c=>this.funding(c)),rate);selected=cs;return result;});built=inserted;offerId=inserted.offer.id;label='Register offer: stake '+intent.terms.stake+', duration '+intent.terms.duration+' seconds, reward '+intent.terms.reward;
   }else {

    if(intent.kind==='withdraw'){
     const entry=(await index.owned(owner.publicKey,intent.offerId)).find(o=>o.id===intent.offerId);if(!entry||entry.status!=='Baked'||!entry.locked||entry.maturesAt===undefined||entry.checkedMtp<entry.maturesAt)throw Error('Stake allocation has not matured');built=this.select(coins,q.ZERO,0n,cs=>{selected=cs;return q.withdraw(c,entry.offer,entry.locked!,authorization,cs.map(c=>this.funding(c)),rate);});offerId=entry.id;label='Get independently matured stake back';
    }else {
     const position=intent.kind==='claim'?{controller:head!.vault,node:head!.node}:cancellationPoint(snapshot!,intent.offerId);if(!position)throw Error('Queue is empty');
     const offer=q.readNode(c,position.node),escrow=c.p.stakingCategory===q.ZERO?undefined:await index.assetInput(offer.stake,offer.id);
     const state=head?.state??snapshot!.state,clock=head?.clock??snapshot!.clock;
     const action=intent.kind==='cancel'?1:offer.reward>state.reserve?3:2;
     const reserve=action===2&&c.p.rewardCategory!==q.ZERO?await index.assetInput(state.reserve):undefined;
     if(action===2&&q.rewardStatus(c.p,state,offer.reward,clock.mtp-1)!=='available')throw Error('Rewards await the next scheduled release');
     built=this.select(coins,q.ZERO,0n,cs=>{selected=cs;return q.remove(c,position.controller,position.node,action,cs.map(c=>this.funding(c)),action===1?authorization:undefined,escrow,reserve,action===2?clock.mtp-1:0,rate);});authorize=action===1;offerId=offer.id;label=action===3?'Return unfundable head stake to its owner':action===2?'Pay head reward and create independent stake lock':'Cancel offer and return its complete stake';
    }
   }
  }
  const tx=built.builder.generateWcTransactionObject().transaction as Transaction,changeScript=binToHex(q.ownerScript(hexToBin(owner.publicKey))),walletDebit=(selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-tx.outputs.filter(o=>binToHex(o.lockingBytecode)===changeScript).reduce((n,o)=>n+o.valueSatoshis,0n)).toString();
  if(['create','insert'].includes(intent.kind))label+='; '+(quote?.transactions??1)+' transactions; '+(quote?.approvals??1)+' wallet approvals; total wallet BCH including fees '+(quote?.walletDebit??walletDebit)+' sats';
  const plan=this.plan(built,selected,owner,authorize,label+'; miner fee '+built.fee+' sats at '+rate+' sat/byte'),op:Operation={id,intent,owner,keys,network:this.network(),quote,reservations,completed:previous?.completed??continuation?.completed??0,spentFees:previous?.spentFees??continuation?.spentFees??'0',parent:previous?.parent??continuation?.parent,approved:!quote||!previous&&quote.transactions===1||!!previous?.approved&&json(previous.quote)===json(quote),step,plan,sources:built.sources,rate,stage:'review',signing:'unsigned',config,offerId,walletDebit};await this.store.save(op);this.reviewed.set(id,{seal:this.seal(op),tip:policy.tip});return op;
 }
 async confirm(id:string){const op=await this.get(id);if(op.stage!=='review'||op.signing!=='unsigned'||!this.reviewed.has(id))throw Error('Fresh preparation review required');op.approved=true;await this.store.save(op);return op;}
 async advance(id:string,keys:WalletKey[]){
  let op=await this.get(id);if(op.owner.publicKey!==keys.find(k=>k.path==='receive'&&k.index===0)?.publicKey)throw Error('Resume with the original wallet');
  if(op.step!=='wallet-preparation'||!op.raw)throw Error('No signed preparation to continue');
  op=await this.resume(id,keys);if(!['pending','confirmed'].includes(op.stage)||op.error)throw Error('Preparation status unresolved; inspect recovery before continuing');
  const childId=id+':next';let child:Operation;
  // A crash between child and parent writes must recover the existing child.
  const existing=(await this.store.list()).find(o=>o.id===childId);
  if(existing)child=await this.resume(childId,keys);
  else child=await this.prepare(op.intent,keys,undefined,{id:childId,parent:id,completed:(op.completed??0)+1,spentFees:(BigInt(op.spentFees??'0')+BigInt(op.plan.fee!)).toString()});
  op.next=child.id;await this.store.save(op);
  // Any changed policy, inputs, or costs requires renewed consent. Normal
  // continuation inherits only an exactly matching remaining quote.
  if(child.raw)return child;
  const old=op.quote,next=child.quote;child.approved=false;
  if(old&&next&&next.transactions===old.transactions-1&&next.totalFee===(BigInt(old.totalFee)-BigInt(old.preparationFees[0]!)).toString()&&next.walletDebit===(BigInt(old.walletDebit)-BigInt(old.preparationFees[0]!)).toString()){
   child.approved=true;
  }
  await this.store.save(child);
  return child;
 }
 async authorize(id:string){
  const op=await this.get(id);
  if(op.raw||op.stage!=='review'||!['unsigned','rejected'].includes(op.signing))throw Error('Uncertain or signed operations cannot be rebuilt');
  if(op.quote&&!op.approved)throw Error('Confirm additional wallet approvals before signing');
  const evidence=this.reviewed.get(id);
  if(!evidence||evidence.seal!==this.seal(op)){this.reviewed.delete(id);throw Error('Transaction intent or wallet session changed; prepare and review again');}
  // Never rediscover funding, traverse the queue, or change the reviewed body.
  // Live availability, ancestry/conflicts and policy still come from both peers.
  op.verifiedAt=undefined;await this.store.save(op);
  try{
   const clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true),policy=await this.rate();
   if(clock.hash!==evidence.tip||policy.tip!==clock.hash)throw Error('Tip changed; prepare and review again');
   if(policy.rate!==op.rate)throw Error('Fee policy changed; prepare and review again');
   await this.finality(op,op.plan.request.transaction as Transaction,clock);
   op.verifiedAt=Date.now();await this.store.save(op);return op;
  }catch(e){this.reviewed.delete(id);throw e;}
 }
 async beginSigning(id:string){const op=await this.get(id);if(this.reviewed.get(id)?.seal!==this.seal(op)||op.raw||!['unsigned','rejected'].includes(op.signing)||!op.verifiedAt||Date.now()-op.verifiedAt>10000)throw Error('Fresh queue authorization required');op.signing='requested';await this.store.save(op);return op;}
 async signingFailed(id:string,rejected:boolean,notRequested=false){const op=await this.get(id);if(!op.raw&&!op.signedEvidence){op.signing=rejected?'rejected':'uncertain';op.error=notRequested?'Authorization cancelled before wallet prompt':rejected?'Wallet explicitly refused signing':'Signing status unknown; funding remains reserved';await this.store.save(op);}return op;}
 async retain(id:string,raw:string){
  const op=await this.get(id);
  if((op.raw&&op.raw!==raw)||(op.signedEvidence&&op.signedEvidence!==raw))throw Error('Signed recovery requires identical bytes');
  // Preserve the wallet response even if it fails validation. A late response
  // after disconnect cannot be discarded or replaced with another signature.
  op.signedEvidence=raw;op.signing='uncertain';if(!op.raw)op.stage='review';await this.store.save(op);
  try{
   const result=validateWalletSigned(op.plan,raw,{height:0xffffffff,mtp:0xffffffff},(raw,_sources,_clock,fee)=>{const tx=q.verify({raw,sources:op.sources});if(BigInt(raw.length/2)*op.rate!==fee)throw Error('Signed fee differs from network policy');return {txid:hashTransaction(hexToBin(raw)),fee:fee!,transaction:tx};});
   op.raw=raw;op.txid=result.txid;op.stage='signed';op.signing='signed';op.error=undefined;
   if(op.intent.kind==='create'&&op.step==='action'&&op.config)op.config.anchor.genesis=result.txid;
   await this.store.save(op);this.reviewed.delete(id);return op;
  }catch(e){op.error='Returned signed bytes retained; validation failed: '+String(e);await this.store.save(op);this.reviewed.delete(id);throw e;}
 }

 /** Same maturity rule at the approval and broadcast boundaries. The source
  * transaction/confirmation evidence in clock agrees across independent peers. */
 private async finality(op:Operation,tx:Transaction,clock:Awaited<ReturnType<typeof verifyCoinsAcrossPeers>>,submit?:()=>Promise<void>){
  if(!transactionFinal(tx,clock))throw Error('Transaction is not final');
  await this.provider.session(async()=>{
   const tip=await this.provider.tip();if(tip.hash!==clock.hash)throw Error('Tip changed before transaction submission');
   for(const [i,input]of tx.inputs.entries())if(input.sequenceNumber<0x80000000&&(input.sequenceNumber&65535)>0){
    const evidence=clock.ancestry?.find(row=>row[0]===op.sources[i]!.txid),height=Number(evidence?.[2]);
    if(!evidence?.[3]||height<1||(input.sequenceNumber&4194304)===0)throw Error('Relative maturity requires a confirmed allocation');
    const header=await this.provider.header(height);await this.provider.verifyHeaderChain(height,tip,new Map([[height,header.hash]]));
    const anchor=await this.provider.medianTime(height-1,header.parent);if(clock.mtp<anchor+(input.sequenceNumber&65535)*512)throw Error('Allocation became immature after a chain change');
   }
   if((await this.provider.tip()).hash!==clock.hash)throw Error('Tip changed before transaction submission');
   await submit?.();
  },clock.peer);
 }
 async broadcast(id:string){const op=await this.get(id);if(!op.raw||!op.txid)throw Error('Sign the reviewed operation first');
  try{
   const clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true),tx=decodeTransaction(hexToBin(op.raw));if(typeof tx==='string')throw Error(tx);
   await this.finality(op,tx,clock,async()=>{
    const sent=await this.provider.sendRawTransaction(op.raw!);if(sent!==op.txid)throw Error('Broadcast identity mismatch');
   });
   op.stage='pending';op.error=undefined;await this.store.save(op);return op;
  }catch(e){op.error='Signed bytes retained: '+String(e);await this.store.save(op);throw e;}
 }
 private async knownConflict(op:Operation){
  return verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{
   const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks});
   const conflicts=new Set<string>();
   for(const script of new Set(op.sources.map(u=>u.lockingBytecode!)))for(const h of await p.history(script)){
    if(h.tx_hash===op.txid||h.height<=0)continue;
    const tx=await p.transaction(h.tx_hash);if(!tx.vin.some((i:any)=>op.sources.some(u=>i.txid===u.txid&&i.vout===u.vout)))continue;
    await ancestry(h.tx_hash,h);conflicts.add(h.tx_hash);
   }
   if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during conflict verification');
   const value=[...conflicts].sort()[0];return {value,tip,identity:json({tip:tip.hash,conflicts:[...conflicts].sort()})};
  },{parallel:true});
 }
 async resume(id:string,keys:WalletKey[],retry=false){const op=await this.get(id);if(op.owner.publicKey!==keys.find(k=>k.path==='receive'&&k.index===0)?.publicKey)throw Error('Resume with the original wallet');if(!op.raw){if(!['unsigned','rejected'].includes(op.signing))throw Error('Signing status unknown; retain the journal and inspect the wallet before retrying');return this.prepare(op.intent,keys,op);}let tx:any;try{tx=await confirmedWalletTransaction(this.provider,op.txid!);}catch(e){const conflict=await this.knownConflict(op).catch(()=>undefined);if(conflict){op.stage='conflict';op.error='Confirmed competing spend '+conflict+'; signed bytes retained. Start a new request for the current queue position.';await this.store.save(op);return op;}if(retry)return this.broadcast(id);op.error='Signed transaction retained; independent status unavailable';await this.store.save(op);return op;}
  op.stage=tx.confirmations>0?'confirmed':'pending';op.error=undefined;await this.store.save(op);return op;
 }
 async discard(id:string){const op=await this.get(id);if(op.raw||!['unsigned','rejected'].includes(op.signing))throw Error('Signed or uncertain operations remain recoverable');op.stage='discarded';await this.store.save(op);this.reviewed.delete(id);return op;}
}
export class BrowserQueueStore implements Store {
 private db?:Promise<IDBDatabase>;
 constructor(readonly network:string){if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported queue journal network');}
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('staking-arena-queue-'+this.network,1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Queue journal is blocked by another tab'));r.onsuccess=()=>resolve(r.result);});}
 async list(){const db=await this.open();return new Promise<Operation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async save(op:Operation){if(op.network&&op.network!==this.network)throw Error('Queue journal network mismatch');const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(op,op.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}
