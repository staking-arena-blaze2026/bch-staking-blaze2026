import {TransactionBuilder,placeholderP2PKHUnlocker,placeholderSignature,type SpendableUtxo} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,decodeTransaction,hashTransaction,type Transaction} from '@bitauth/libauth';
import type {ElectrumCore} from '../electrum-core.js';
import {verifyCoins,verifyCoinsAcrossPeers,confirmedWalletTransaction,walletPeers} from '../electrum-wallet.js';
import {walletAddress,validateWalletSigned,type WalletKey,type WalletCoin,type BrowserPlan} from '../transactions-core.js';
import {verifiedProviders} from '../verified-providers.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {transactionFinal} from '../consensus-clock.js';
import {validateNewTime} from '../v3/time-policy.js';
import {utxo,json} from '../arena-core.js';
import {QueueIndexer,type Config} from './chain.js';
import {insertionPoint,cancellationPoint} from './indexer.js';
import {policyRate} from './fees.js';
import * as q from './protocol.js';
import {addAnnouncement,type Announcement} from './discovery.js';
export type Intent={kind:'create';parameters:q.Parameters}|{kind:'insert';config:Config;terms:q.Score}|{kind:'cancel'|'withdraw';config:Config;offerId:string}|{kind:'claim';config:Config;expectedHead?:string};
export interface Operation {
 id:string;intent:Intent;owner:WalletKey;keys:WalletKey[];stage:'review'|'signed'|'pending'|'confirmed'|'conflict'|'discarded';
 step:'queue-funding'|'seed-funding'|'action';plan:BrowserPlan;sources:SpendableUtxo[];rate:bigint;raw?:string;txid?:string;verifiedAt?:number;error?:string;
 queueCoin?:SpendableUtxo;seed?:SpendableUtxo;config?:Config;offerId?:string;
 history:{step:string;raw:string;txid:string}[];
 signing:'unsigned'|'requested'|'rejected'|'uncertain'|'signed';
}
export interface Store {list():Promise<Operation[]>;save(op:Operation):Promise<void>}
const outpoint=(u:SpendableUtxo)=>u.txid+':'+u.vout;
/** Plans, public derivation paths and signed bytes are durable; private keys
 * never enter this service. All actions share the same approval/broadcast path. */
export class QueueWallet {
 constructor(readonly provider:ElectrumCore,readonly store:Store){}
 async get(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op)throw Error('Unknown queue operation');return op;}
 private funding(coin:WalletCoin):q.Funding{return {input:coin.utxo,unlocker:placeholderP2PKHUnlocker(walletAddress(hexToBin(coin.publicKey),this.network()))};}
 private network(){const network=String(this.provider.network);if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported queue network');return network as 'mainnet'|'chipnet'|'regtest';}
 private authorization(owner:WalletKey){return {publicKey:hexToBin(owner.publicKey),authorization:placeholderSignature()};}
 private async rate(){return verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{const tip=await p.tip(),rate=policyRate(await p.request('blockchain.relayfee'));return {value:rate,tip,identity:tip.hash+':'+rate};});}
 private async inventory(keys:WalletKey[],id:string){
  if(!keys.length||keys.length>600||new Set(keys.map(k=>k.path+':'+k.index)).size!==keys.length)throw Error('Invalid wallet descriptor');
  const coins=await verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
   const tip=await p.tip(),coins:WalletCoin[]=[];
   for(const key of keys){if(!['receive','change','defi'].includes(key.path)||!Number.isInteger(key.index)||key.index<0||key.index>=200)throw Error('Invalid wallet derivation');walletAddress(hexToBin(key.publicKey),this.network());const script=binToHex(q.ownerScript(hexToBin(key.publicKey)));for(const u of await p.getUtxosForLockingBytecode(script))if(!u.token?.nft)coins.push({...key,utxo:u});}
   if(new Set(coins.map(c=>outpoint(c.utxo))).size!==coins.length)throw Error('Duplicate wallet funding');
   await verifyCoins(p,coins.map(c=>c.utxo),peer,true);if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during funding discovery');
   coins.sort((a,b)=>outpoint(a.utxo).localeCompare(outpoint(b.utxo)));return {value:coins,tip,identity:json({tip:tip.hash,coins})};
  },{parallel:true});
  const list=await this.store.list(),reserved=new Set(list.filter(o=>o.id!==id&&!['confirmed','discarded','conflict'].includes(o.stage)).flatMap(o=>[...o.sources,...(o.queueCoin?[o.queueCoin]:[]),...(o.seed?[o.seed]:[])].map(outpoint)));
  return coins.filter(c=>!reserved.has(outpoint(c.utxo))).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1);
 }
 private plan(built:ReturnType<typeof q.priced>,coins:WalletCoin[],owner:WalletKey,authorize:boolean,label:string):BrowserPlan{
  const request=built.builder.generateWcTransactionObject({broadcast:false,userPrompt:label}),inputPaths:BrowserPlan['inputPaths']=[],signers:Record<number,string>={};
  for(const [i,u]of built.sources.entries()){const coin=coins.find(c=>outpoint(c.utxo)===outpoint(u));if(coin){inputPaths.push([i,coin.path,coin.index]);signers[i]=coin.publicKey;}}
  if(authorize){inputPaths.unshift([0,owner.path,owner.index]);signers[0]=owner.publicKey;}
  return {kind:'offer',label,request,inputPaths,signers,fee:built.fee.toString()};
 }
 private payment(coin:WalletCoin,to:string,amount:bigint,rate:bigint,announcement?:Announcement){return q.priced(fee=>{const b=new TransactionBuilder({provider:this.provider}).addInput(coin.utxo,this.funding(coin).unlocker).addOutput({to,amount});if(announcement)addAnnouncement(b,this.provider,announcement);const change=coin.utxo.satoshis-amount-fee-(announcement?1000n:0n);if(change<0n)throw Error('Insufficient BCH');if(change)b.addOutput({to:walletAddress(hexToBin(coin.publicKey),this.network()),amount:change,...(coin.utxo.token?{token:coin.utxo.token}:{})});else if(coin.utxo.token)throw Error('Missing token change carrier');return b;},[coin.utxo],rate);}
 private select<T>(coins:WalletCoin[],asset:string,amount:bigint,build:(selected:WalletCoin[])=>T):T{
  const eligible=coins.filter(c=>!c.utxo.token||asset!==q.ZERO&&c.utxo.token.category===asset),selected:WalletCoin[]=[];
  // Token inputs first, then the fewest largest BCH coins needed for the measured fee.
  eligible.sort((a,b)=>a.utxo.token&&!b.utxo.token?-1:!a.utxo.token&&b.utxo.token?1:a.utxo.satoshis>b.utxo.satoshis?-1:1);
  let tokens=0n,last:unknown;
  for(const coin of eligible){if(selected.length===16)break;selected.push(coin);tokens+=coin.utxo.token?.amount??0n;if(asset!==q.ZERO&&tokens<amount)continue;try{return build(selected);}catch(e){if(!/Insufficient BCH|dust|minimum|negative|lower than/i.test(String(e)))throw e;last=e;}}
  throw last??Error('Insufficient wallet funding for the selected assets and measured fee');
 }
 async prepare(intent:Intent,keys:WalletKey[],previous?:Operation):Promise<Operation>{
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner||previous&&previous.owner.publicKey!==owner.publicKey)throw Error('Resume with the original wallet');
  const id=previous?.id??crypto.randomUUID(),coins=await this.inventory(keys,id),rate=await this.rate(),authorization=this.authorization(owner);
  let step:Operation['step']='action',built:ReturnType<typeof q.priced>,authorize=true,selected:WalletCoin[]=[],config=previous?.config,offerId=previous?.offerId,queueCoin=previous?.queueCoin,seed=previous?.seed;let label:string=intent.kind;
  if(intent.kind==='create'){
   q.parameters(intent.parameters);
   validateNewTime(intent.parameters.interval,this.network(),'Interval');
   if(!queueCoin){const zeros=coins.filter(c=>!c.utxo.token&&c.utxo.vout===0);if(zeros.length&&coins.some(c=>outpoint(c.utxo)!==outpoint(zeros[0]!.utxo)))queueCoin=zeros[0]!.utxo;}
   if(!queueCoin){step='queue-funding';authorize=false;const choice=coins.find(c=>c.utxo.satoshis>4000n);if(!choice)throw Error('BCH funding is required for queue genesis preparation');selected=[choice];built=this.payment(choice,walletAddress(hexToBin(owner.publicKey),this.network()),q.CARRIER,rate);label='Prepare queue genesis coin';}
   else if(!seed){step='seed-funding';authorize=false;const choice=coins.find(c=>outpoint(c.utxo)!==outpoint(queueCoin!)&&c.utxo.satoshis>4000n);if(!choice)throw Error('Resume creation after queue funding propagates');selected=[choice];built=this.payment(choice,q.genesis(intent.parameters,hexToBin(owner.publicKey),this.provider).address,q.CARRIER,rate,{parameters:intent.parameters,creator:owner.publicKey,queue:queueCoin.txid});label='Prepare constrained vault genesis and public listing';}
   else {
    const queueKey=keys.find(k=>binToHex(q.ownerScript(hexToBin(k.publicKey)))===queueCoin!.lockingBytecode);if(!queueKey)throw Error('Queue funding owner changed');
    const queueFunding=this.funding({...queueKey,utxo:queueCoin});
    const available=coins.filter(c=>![outpoint(queueCoin!),outpoint(seed!)].includes(outpoint(c.utxo))),asset=intent.parameters.rewardCategory,reserve=BigInt(intent.parameters.releases)*intent.parameters.cap;
    const created=this.select(available,asset,reserve,cs=>{const result=q.create(intent.parameters,seed!,queueFunding,cs.map(c=>this.funding(c)),authorization,this.provider,rate);selected=[{...queueKey,utxo:queueCoin!},...cs];return result;});built=created;config={parameters:intent.parameters,identity:created.context.identity,anchor:{genesis:'',creator:owner.publicKey}};label='Create vault with full reward reserve';
   }
  }else {
   const index=new QueueIndexer(this.provider,intent.config),snapshot=await index.sync(),c=index.context();config=intent.config;if(intent.kind==='claim'&&intent.expectedHead&&snapshot.state.head.id!==intent.expectedHead)throw Error('Winning offer changed; review the current head before claiming');
   if(intent.kind==='insert'){
    if(intent.terms.reward>snapshot.state.reserve)throw Error('Reward request can never be funded by the remaining reserve');
    const position=insertionPoint(snapshot,intent.terms),inserted=this.select(coins,c.p.stakingCategory,intent.terms.stake,cs=>{const result=q.insert(c,position.controller,position.authority,intent.terms,authorization,cs.map(c=>this.funding(c)),rate);selected=cs;return result;});built=inserted;offerId=inserted.offer.id;label='Register offer: stake '+intent.terms.stake+', duration '+intent.terms.duration+' seconds, reward '+intent.terms.reward;
   }else {

    if(intent.kind==='withdraw'){
     const entry=(await index.owned(owner.publicKey)).find(o=>o.id===intent.offerId);if(!entry||entry.status!=='Baked'||!entry.locked||entry.maturesAt===undefined||snapshot.clock.mtp<entry.maturesAt)throw Error('Stake allocation has not matured');built=this.select(coins,q.ZERO,0n,cs=>{selected=cs;return q.withdraw(c,entry.offer,entry.locked!,authorization,cs.map(c=>this.funding(c)),rate);});offerId=entry.id;label='Get independently matured stake back';
    }else {
     const position=intent.kind==='claim'?snapshot.ordered[0]?{controller:snapshot.vault,node:snapshot.nodes.get(snapshot.ordered[0].id)!.utxo}:undefined:cancellationPoint(snapshot,intent.offerId);if(!position)throw Error('Queue is empty');
     const offer=q.readNode(c,position.node),escrow=c.p.stakingCategory===q.ZERO?undefined:await index.assetInput(offer.stake,offer.id);
     const action=intent.kind==='cancel'?1:offer.reward>snapshot.state.reserve?3:2;
     const reserve=action===2&&c.p.rewardCategory!==q.ZERO?await index.assetInput(snapshot.state.reserve):undefined;
     if(action===2&&q.rewardStatus(c.p,snapshot.state,offer.reward,snapshot.clock.mtp-1)!=='available')throw Error('Rewards await the next scheduled release');
     built=this.select(coins,q.ZERO,0n,cs=>{selected=cs;return q.remove(c,position.controller,position.node,action,cs.map(c=>this.funding(c)),action===1?authorization:undefined,escrow,reserve,action===2?snapshot.clock.mtp-1:0,rate);});authorize=action===1;offerId=offer.id;label=action===3?'Return unfundable head stake to its owner':action===2?'Pay head reward and create independent stake lock':'Cancel offer and return its complete stake';
    }
   }
  }
  const plan=this.plan(built,selected,owner,authorize,label+'; miner fee '+built.fee+' sats at '+rate+' sat/byte'),op:Operation={id,intent,owner,keys,step,plan,sources:built.sources,rate,stage:'review',signing:'unsigned',queueCoin,seed,config,offerId,history:previous?.history??[]};await this.store.save(op);return op;
 }
 async authorize(id:string){const original=await this.get(id);if(original.raw||original.stage!=='review'||!['unsigned','rejected'].includes(original.signing))throw Error('Uncertain or signed operations cannot be rebuilt');const op=await this.prepare(original.intent,original.keys,original),clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true);op.verifiedAt=Date.now();await this.store.save(op);return op;}
 async beginSigning(id:string){const op=await this.get(id);if(op.raw||!['unsigned','rejected'].includes(op.signing)||!op.verifiedAt||Date.now()-op.verifiedAt>10000)throw Error('Fresh queue authorization required');op.signing='requested';await this.store.save(op);return op;}
 async signingFailed(id:string,rejected:boolean,notRequested=false){const op=await this.get(id);if(!op.raw){op.signing=rejected?'rejected':'uncertain';op.error=notRequested?'Authorization cancelled before wallet prompt':rejected?'Wallet explicitly refused signing':'Signing status unknown; funding remains reserved';await this.store.save(op);}return op;}
 async retain(id:string,raw:string){const op=await this.get(id);if(op.raw&&op.raw!==raw)throw Error('Signed recovery requires identical bytes');const result=validateWalletSigned(op.plan,raw,{height:0xffffffff,mtp:0xffffffff},(raw,_sources,_clock,fee)=>{const tx=q.verify({raw,sources:op.sources});if(BigInt(raw.length/2)*op.rate!==fee)throw Error('Signed fee differs from network policy');return {txid:hashTransaction(hexToBin(raw)),fee:fee!,transaction:tx};});op.raw=raw;op.txid=result.txid;op.stage='signed';op.signing='signed';if(op.intent.kind==='create'&&op.step==='action'&&op.config)op.config.anchor.genesis=result.txid;await this.store.save(op);return op;}
 async broadcast(id:string){const op=await this.get(id);if(!op.raw||!op.txid)throw Error('Sign the reviewed operation first');const clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true),tx=decodeTransaction(hexToBin(op.raw));if(typeof tx==='string'||!transactionFinal(tx,clock))throw Error('Transaction is not final');
  try{await this.provider.session(async()=>{
   const tip=await this.provider.tip();if(tip.hash!==clock.hash)throw Error('Tip changed before broadcast');
   for(const [i,input]of tx.inputs.entries())if(input.sequenceNumber<0x80000000&&(input.sequenceNumber&65535)>0){
    const evidence=clock.ancestry?.find(row=>row[0]===op.sources[i]!.txid),height=Number(evidence?.[2]);
    if(!evidence?.[3]||height<1||(input.sequenceNumber&4194304)===0)throw Error('Relative maturity requires a confirmed allocation');
    const header=await this.provider.header(height);await this.provider.verifyHeaderChain(height,tip,new Map([[height,header.hash]]));
    const anchor=await this.provider.medianTime(height-1,header.parent);if(clock.mtp<anchor+(input.sequenceNumber&65535)*512)throw Error('Allocation became immature after a chain change');
   }
   if((await this.provider.tip()).hash!==clock.hash)throw Error('Tip changed before broadcast');
   const sent=await this.provider.sendRawTransaction(op.raw!);if(sent!==op.txid)throw Error('Broadcast identity mismatch');
  },clock.peer);op.stage='pending';op.error=undefined;await this.store.save(op);return op;}catch(e){op.error='Signed bytes retained: '+String(e);await this.store.save(op);throw e;}
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
 async resume(id:string,keys:WalletKey[],retry=false){const op=await this.get(id);if(!op.raw){if(!['unsigned','rejected'].includes(op.signing))throw Error('Signing status unknown; retain the journal and inspect the wallet before retrying');return this.prepare(op.intent,keys,op);}let tx:any;try{tx=await confirmedWalletTransaction(this.provider,op.txid!);}catch(e){const conflict=await this.knownConflict(op).catch(()=>undefined);if(conflict){op.stage='conflict';op.error='Confirmed competing spend '+conflict+'; signed bytes retained. Start a new request for the current queue position.';await this.store.save(op);return op;}if(retry)return this.broadcast(id);op.error='Signed transaction retained; independent status unavailable';await this.store.save(op);return op;}
  if(op.intent.kind==='create'&&op.step!=='action'){
   op.history.push({step:op.step,raw:op.raw,txid:op.txid!});if(op.step==='queue-funding')op.queueCoin=utxo(tx,0);else op.seed=utxo(tx,0);op.raw=undefined;op.txid=undefined;return this.prepare(op.intent,keys,op);
  }
  op.stage=tx.confirmations>0?'confirmed':'pending';await this.store.save(op);return op;
 }
 async discard(id:string){const op=await this.get(id);if(op.raw||op.seed||!['unsigned','rejected'].includes(op.signing))throw Error('Signed, uncertain or covenant-funded creation remains recoverable');op.stage='discarded';await this.store.save(op);return op;}
}
export class BrowserQueueStore implements Store {
 private db?:Promise<IDBDatabase>;
 constructor(readonly network:string){}
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('staking-arena-queue-'+this.network,1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Queue journal is blocked by another tab'));r.onsuccess=()=>resolve(r.result);});}
 async list(){const db=await this.open();return new Promise<Operation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async save(op:Operation){const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(op,op.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}
