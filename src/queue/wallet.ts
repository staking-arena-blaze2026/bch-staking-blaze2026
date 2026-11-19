import {boundedMap} from '../bounded-map.js';
import {timed} from '../operation-timing.js';
import {BchFundingError,errorMessage} from './funding.js';
import {TransactionBuilder,placeholderP2PKHUnlocker,placeholderSignature,type SpendableUtxo} from 'cashscript';
import {binToHex,hexToBin,decodeTransaction,hashTransaction,type Transaction} from '@bitauth/libauth';
import type {ElectrumCore} from '../electrum-core.js';
import {coinIdentity,verifyCoins,verifyCoinsAcrossPeers,confirmedWalletTransaction,walletPeers} from '../electrum-wallet.js';
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
export type Intent={kind:'recover';operationId:string}|{kind:'create';parameters:q.Parameters}|{kind:'insert';config:Config;terms:q.Score}|{kind:'cancel'|'withdraw';config:Config;offerId:string}|{kind:'claim';config:Config;expectedHead?:string};
export interface Operation {
 id:string;intent:Intent;owner:WalletKey;keys:WalletKey[];stage:'review'|'signed'|'pending'|'confirmed'|'conflict'|'discarded';
 queueCoin?:SpendableUtxo;seed?:SpendableUtxo;
 history?:{step:string;raw:string;txid:string}[];
 recovery?:{operationId:string;transactionId:string;seal:string};recoveryResolved?:boolean;supersededBy?:string;
 reservationEvidence?:{kind:'verified-unspent-inputs';tip:string;inputCount:number;bch:string};
 network?:'mainnet'|'chipnet'|'regtest';reservationResolution?:'confirmed'|'conflict'|'unresolved';
 step:'action'|'wallet-preparation'|'wallet-recovery';quote?:CreationQuote;completed?:number;spentFees?:string;parent?:string;next?:string;approved?:boolean;reservations?:SpendableUtxo[];plan:BrowserPlan;sources:SpendableUtxo[];rate:bigint;signedEvidence?:string;raw?:string;txid?:string;verifiedAt?:number;error?:string;
 config?:Config;offerId?:string;walletDebit?:string;
 signing:'unsigned'|'requested'|'rejected'|'uncertain'|'signed';
}
export interface Store {list():Promise<Operation[]>;save(op:Operation):Promise<void>}
export interface FundingEvidence {verified:string;available:string;reserved:string;restricted:string;eligibleGenesis:number;addresses:number;reservations:{id:string;step:string;txid?:string;satoshis:string;reason:string}[]}
const legacyAnchors=(op:Operation)=>{
 if(op.supersededBy&&op.stage==='conflict'&&op.reservationResolution==='conflict')return [];
 const refs=[...(op.queueCoin?[op.queueCoin]:[]),...(op.seed?[op.seed]:[])];
 // A proven ordinary wallet self-send has no covenant continuation to protect.
 // Unknown scripts/status and any non-wallet seed retain every linked anchor.
 if(op.raw&&op.reservationResolution==='confirmed'&&refs.every(u=>!u.token?.nft&&!!u.lockingBytecode&&/^76a914[a-f0-9]{40}88ac$/.test(u.lockingBytecode)))return [];
 return refs;
};
const reservationInputs=(op:Operation)=>[...(op.reservations??op.sources),...legacyAnchors(op)];
const outpoint=(u:SpendableUtxo)=>u.txid+':'+u.vout;
/** Plans, public derivation paths and signed bytes are durable; private keys
 * never enter this service. All actions share the same approval/broadcast path. */
export class QueueWallet {
 private preliminary?:{scope:string;key:string;sequence:ReturnType<typeof creationSequence>};
 private discovery?:{id:string;peers:Map<string,{tip:string;rows:Map<string,WalletCoin[]>}>};
 private readonly reviewed=new Map<string,{seal:string;tip:string;height:number;authorizedAt?:number}>();
 invalidateReviews(){this.reviewed.clear();this.discovery=undefined;this.preliminary=undefined;}
 private seal(op:Operation){return json({intent:op.intent,owner:op.owner,keys:op.keys,step:op.step,plan:op.plan,sources:op.sources,rate:op.rate,config:op.config,offerId:op.offerId,network:op.network,quote:op.quote,completed:op.completed,spentFees:op.spentFees,parent:op.parent,reservations:op.reservations,recovery:op.recovery});}
 constructor(readonly provider:ElectrumCore,readonly store:Store){}
 async get(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op)throw Error('Unknown queue operation');if(op.network&&op.network!==this.network())throw Error('Queue journal network mismatch');if(!['action','wallet-preparation','wallet-recovery'].includes(op.step))throw Error('Legacy transaction evidence requires manual inspection');return op;}
 private funding(coin:WalletCoin):q.Funding{return {input:coin.utxo,unlocker:placeholderP2PKHUnlocker(walletAddress(hexToBin(coin.publicKey),this.network()))};}
 private network(){const network=String(this.provider.network);if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported queue network');return network as 'mainnet'|'chipnet'|'regtest';}
 private authorization(owner:WalletKey){return {publicKey:hexToBin(owner.publicKey),authorization:placeholderSignature()};}
 private async rate(){return timed(this.provider,'fee-policy',()=>verifiedProviders(this.provider,walletPeers(this.provider),async(_peer,p)=>{const tip=await p.tip(),rate=policyRate(await p.request('blockchain.relayfee'));return {value:{rate,tip:tip.hash,height:tip.height},tip,identity:tip.hash+':'+rate};},{parallel:true}));}
 private async inventory(keys:WalletKey[],id:string,ignoreReservation?:string,discoveryId?:string){
  if(!keys.length||keys.length>600||new Set(keys.map(k=>k.path+':'+k.index)).size!==keys.length)throw Error('Invalid wallet descriptor');
  if(discoveryId&&this.discovery?.id!==discoveryId)this.discovery={id:discoveryId,peers:new Map()};
  const verified=await timed(this.provider,'wallet-address-discovery',()=>verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
   const tip=await p.tip(),coins:WalletCoin[]=[];let addresses=0,avoided=0;const lookupStart=performance.now(),before={...p.requestCounts};
   // Lists retained only within this progressive discovery are candidates,
   // never spendability proof. Funded scripts are freshly read by verifyCoins.
   let cache=discoveryId?this.discovery?.peers.get(peer):undefined;
   if(!cache||cache.tip!==tip.hash){cache={tip:tip.hash,rows:new Map()};if(discoveryId)this.discovery?.peers.set(peer,cache);}
   const rows=cache.rows;
   try{await boundedMap(keys,4,async key=>{
    if(!['receive','change','defi'].includes(key.path)||!Number.isInteger(key.index)||key.index<0||key.index>=200)throw Error('Invalid wallet derivation');
    walletAddress(hexToBin(key.publicKey),this.network());const script=binToHex(q.ownerScript(hexToBin(key.publicKey)));
    if(rows.has(script))avoided++;else {addresses++;rows.set(script,(await p.getUtxosForLockingBytecode(script)).filter(u=>!u.token?.nft).map(utxo=>({...key,utxo})));}
    return script;
   });}catch(error){rows.clear();throw error;}
   for(const key of keys)coins.push(...rows.get(binToHex(q.ownerScript(hexToBin(key.publicKey))))!);
   if(new Set(coins.map(c=>outpoint(c.utxo))).size!==coins.length)throw Error('Duplicate wallet funding');
   const requests=Object.fromEntries(Object.entries(p.requestCounts).map(([method,count])=>[method,count-(before[method]??0)]).filter(([,count])=>count));
   this.provider.onTiming?.({stage:'wallet-utxo-retrieval',milliseconds:performance.now()-lookupStart,requests,ok:true,addresses,repeatedRequestsAvoided:avoided});
   try{if(coins.length)await timed(p,'wallet-input-verification',()=>verifyCoins(p,coins.map(c=>c.utxo),peer,true));}catch(error){rows.clear();throw error;}if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during funding discovery');
   coins.sort((a,b)=>outpoint(a.utxo).localeCompare(outpoint(b.utxo)));return {value:{coins,tip:tip.hash},tip,identity:json({tip:tip.hash,coins})};
  },{parallel:true}));
  const coins=verified.coins;
  let list=await this.store.list();
  for(const op of list)if(!op.network||op.network===this.network())this.reservePreparationOutputs(op);
  const live=new Set(coins.map(c=>outpoint(c.utxo)));
  // An independently re-read, identical complete set of actual signed inputs
  // can only justify retaining an unresolved reservation, never releasing it.
  const stillReserved=(op:Operation)=>op.reservationResolution==='unresolved'&&op.reservationEvidence?.kind==='verified-unspent-inputs'&&op.reservationEvidence.tip===verified.tip&&op.sources.length>0&&op.sources.every(u=>coins.some(c=>outpoint(c.utxo)===outpoint(u)&&coinIdentity(c.utxo)===coinIdentity(u)));
  const relevant=(op:Operation)=>reservationInputs(op).some(u=>live.has(outpoint(u)))||coins.some(c=>c.utxo.txid===op.txid);
  // A previously confirmed spend can disappear in a reorganization. If a
  // reserved input reappears, old journal classifications cannot release it.
  for(const op of list.filter(o=>o.step!=='wallet-recovery'))if((!op.network||op.network===this.network())&&op.id!==id&&op.raw&&op.stage!=='discarded'&&relevant(op)&&!stillReserved(op)&&(!['confirmed','conflict'].includes(op.stage)||!['action','wallet-preparation'].includes(op.step)||reservationInputs(op).some(u=>live.has(outpoint(u)))))await timed(this.provider,'legacy-reservation-reconciliation',()=>this.reconcileReservation(op));
  for(const op of list.filter(o=>o.step==='wallet-recovery'&&o.raw))if((!op.network||op.network===this.network())&&relevant(op))await this.reconcileReservation(op);
  list=await this.store.list();
  const active=list.filter(o=>(!o.network||o.network===this.network())&&o.id!==id&&o.id!==ignoreReservation&&!id.startsWith(o.id+':next')&&o.stage!=='discarded'&&(o.stage!=='conflict'||o.reservationResolution==='unresolved')&&(o.stage!=='confirmed'||o.reservationResolution==='unresolved'||o.step==='wallet-preparation'&&!o.next||!['action','wallet-preparation'].includes(o.step)&&(o.reservationResolution!=='confirmed'||legacyAnchors(o).length>0)));
  const anchored=list.filter(o=>o.id!==ignoreReservation&&(!o.network||o.network===this.network())&&legacyAnchors(o).length>0);
  const records=[...new Map([...active,...anchored].map(o=>[o.id,o])).values()];
  const reserved=new Set([...active.flatMap(o=>reservationInputs(o).map(outpoint)),...anchored.flatMap(o=>legacyAnchors(o).map(outpoint))]);
  const available=coins.filter(c=>!reserved.has(outpoint(c.utxo))).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1),sum=(cs:WalletCoin[])=>cs.reduce((n,c)=>n+c.utxo.satoshis,0n).toString();
  return {coins:available,evidence:{verified:sum(coins),available:sum(available),reserved:sum(coins.filter(c=>reserved.has(outpoint(c.utxo)))),restricted:'0',eligibleGenesis:0,addresses:keys.length,reservations:records.map(o=>({id:o.id,step:o.step,txid:o.txid,reason:o.step==='wallet-preparation'?'Self-send outputs and funding are reserved for the approved creation continuation. Inspect / resume this sequence; confirmation alone does not release its continuation inputs.':legacyAnchors(o).length?(o.error?o.error+' ':'')+'Legacy seed/queue continuation references require manual inspection before release; historical fields and signed bytes are retained.':o.error??(!o.raw&&['unsigned','rejected'].includes(o.signing)?'Unsigned reviewed request. Discard it in Transaction recovery if no longer needed.':'Signed or uncertain wallet request. Inspect its independent transaction status and check Cashonize before retrying.'),satoshis:sum(coins.filter(c=>reservationInputs(o).some(u=>outpoint(u)===outpoint(c.utxo))))})).filter(o=>o.satoshis!=='0')} satisfies FundingEvidence};
 }
 /** Reserve real self-send outputs as soon as their immutable signed txid is
  * known. Original inputs alone cannot protect continuation after broadcast. */
 private reservePreparationOutputs(op:Operation){
  if((op.step!=='wallet-preparation'&&op.step!=='wallet-recovery')||op.step==='wallet-recovery'&&op.recoveryResolved||!op.raw||!op.txid||hashTransaction(hexToBin(op.raw))!==op.txid)return;
  const tx=decodeTransaction(hexToBin(op.raw));if(typeof tx==='string')return;
  const script=binToHex(q.ownerScript(hexToBin(op.owner.publicKey)));
  const outputs:SpendableUtxo[]=tx.outputs.flatMap((o,vout)=>binToHex(o.lockingBytecode)===script?[{txid:op.txid!,vout,satoshis:o.valueSatoshis,lockingBytecode:script,...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount}}:{})}]:[]);
  op.reservations=[...new Map([...(op.reservations??op.sources),...outputs].map(u=>[outpoint(u),u])).values()];
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
 private legacySeal(op:Operation){return json({id:op.id,owner:op.owner,intent:op.intent,raw:op.raw,txid:op.txid,sources:op.sources,queueCoin:op.queueCoin,seed:op.seed,history:op.history,reservations:op.reservations});}
 private async recoveryTarget(id:string,owner:WalletKey){
  const op=(await this.store.list()).find(o=>o.id===id);
  if(!op||op.network&&op.network!==this.network())throw Error('Old request is not in this network journal');
  if(op.owner.publicKey!==owner.publicKey)throw Error('Connect the original wallet to resolve this old request');
  if(op.intent.kind!=='create'||!['seed-funding','queue-funding'].includes(op.step))throw Error('This request needs manual recovery; automatic resolution supports old wallet funding requests only');
  if(!op.raw||!op.txid||hashTransaction(hexToBin(op.raw))!==op.txid)throw Error('Old signed bytes are unavailable or inconsistent. Inspect the old request before recovery');
  const tx=decodeTransaction(hexToBin(op.raw)),points=new Set(op.sources.map(outpoint));
  if(typeof tx==='string'||!op.sources.length||points.size!==op.sources.length||tx.inputs.length!==points.size||tx.inputs.some(i=>!points.has(binToHex(i.outpointTransactionHash)+':'+i.outpointIndex)))throw Error('Old signed inputs do not match its journal. Manual inspection is required');
  const refs=[...new Map([...op.sources,...(op.reservations??[]),...(op.queueCoin?[op.queueCoin]:[]),...(op.seed?[op.seed]:[])].map(u=>[outpoint(u),u])).values()];
  if(refs.some(u=>u.token||!u.lockingBytecode||!/^76a914[a-f0-9]{40}88ac$/.test(u.lockingBytecode)))throw Error('This old request references covenant, token or unknown funds. Use manual inspection; automatic resolution will not spend or abandon them');
  for(const h of op.history??[]){const t=decodeTransaction(hexToBin(h.raw));if(typeof t==='string'||hashTransaction(hexToBin(h.raw))!==h.txid||t.outputs.some(o=>o.token||!/^76a914[a-f0-9]{40}88ac$/.test(binToHex(o.lockingBytecode))&&o.lockingBytecode[0]!==0x6a))throw Error('Old transaction history may contain covenant funds. Manual inspection is required');}
  return {op,refs};
 }
 private async assertNoExistingCovenantFunds(op:Operation){
  const tx=decodeTransaction(hexToBin(op.raw!));if(typeof tx==='string')throw Error('Cannot inspect old signed outputs');
  const scripts=[...new Set(tx.outputs.filter(o=>!/^76a914[a-f0-9]{40}88ac$/.test(binToHex(o.lockingBytecode))&&o.lockingBytecode[0]!==0x6a).map(o=>binToHex(o.lockingBytecode)))];
  if(!scripts.length)return;
  const found=await verifiedProviders(this.provider,walletPeers(this.provider),async(peer,p)=>{
   const tip=await p.tip(),coins:SpendableUtxo[]=[];for(const script of scripts)coins.push(...await p.getUtxosForLockingBytecode(script));coins.sort((a,b)=>outpoint(a).localeCompare(outpoint(b)));
   if(coins.length)await verifyCoins(p,coins,peer,true);if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during old covenant inspection');
   return {value:coins.length,tip,identity:json({tip:tip.hash,coins})};
  },{parallel:true});
  if(found)throw Error('The old request address already holds covenant funds. Automatic wallet-only resolution is unavailable; inspect those funds before changing its continuation inputs');
 }
 private async prepareRecovery(targetId:string,keys:WalletKey[],previous?:Operation):Promise<Operation>{
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Connect the original wallet to resolve this request');
  const target=await this.recoveryTarget(targetId,owner);
  const existing=(await this.store.list()).find(o=>o.recovery?.operationId===targetId&&!['discarded','conflict'].includes(o.stage));
  if(existing?.raw)return this.reconcileRecovery(existing.id);
  if(existing&&!['unsigned','rejected'].includes(existing.signing))throw Error('A resolution approval is already unresolved. Inspect that recovery before starting another');
  const id=previous?.id??existing?.id??crypto.randomUUID();
  const inventory=await this.inventory(keys,id,targetId),current=await this.recoveryTarget(targetId,owner);
  if(current.op.supersededBy&&current.op.reservationResolution==='conflict')throw Error('This old request is already resolved. Continue creating your new vault');
  if(current.op.stage==='confirmed'||current.op.stage==='pending')throw Error('The old transaction is already on the network. Inspect its outputs before recovery');
  const byPoint=new Map(inventory.coins.map(c=>[outpoint(c.utxo),c]));
  for(const ref of current.refs){const coin=byPoint.get(outpoint(ref));if(!coin||json(coin.utxo.token??null)!==json(ref.token??null)||coin.utxo.satoshis!==ref.satoshis||coin.utxo.lockingBytecode!==ref.lockingBytecode)throw Error('Old funding is spent, reserved by another request, or not verified in this wallet. Inspect recovery before continuing');}
  await verifyCoinsAcrossPeers(this.provider,current.refs,true);
  await this.assertNoExistingCovenantFunds(current.op);
  const policy=await this.rate(),selected=current.op.sources.map(u=>byPoint.get(outpoint(u))!);
  if(selected.length>16)throw Error('Too many old signed inputs for automatic resolution. Manual inspection is required');
  const extras=inventory.coins.filter(c=>!c.utxo.token&&!selected.some(s=>outpoint(s.utxo)===outpoint(c.utxo)));
  let built:ReturnType<typeof q.priced>;
  for(;;){try{built=q.priced(fee=>{const b=new TransactionBuilder({provider:this.provider});for(const c of selected){const f=this.funding(c);b.addInput(f.input,f.unlocker);}const total=selected.reduce((n,c)=>n+c.utxo.satoshis,0n);return b.addOutput({to:q.ownerScript(hexToBin(owner.publicKey)),amount:q.fundingRemainder(b,total,0n,fee,'legacy resolution',false)});},selected.map(c=>c.utxo),policy.rate);break;}catch(e){if(!(e instanceof BchFundingError)||!extras.length||selected.length>=16)throw e;selected.push(extras.shift()!);}}
  const total=selected.reduce((n,c)=>n+c.utxo.satoshis,0n),recovery={operationId:targetId,transactionId:current.op.txid!,seal:this.legacySeal(current.op)},quote:CreationQuote={transactions:1,approvals:1,preparationFees:[],creationFee:'0',totalFee:built.fee.toString(),walletDebit:built.fee.toString(),reserve:'0',rewardCategory:q.ZERO,recovery:{operationId:targetId,transactionId:current.op.txid!,reservedBch:current.refs.reduce((n,u)=>n+u.satoshis,0n).toString(),returnedBch:(total-built.fee).toString()}};
  const op:Operation={id,intent:{kind:'recover',operationId:targetId},owner,keys,network:this.network(),step:'wallet-recovery',stage:'review',signing:'unsigned',approved:false,recovery,quote,rate:policy.rate,sources:built.sources,reservations:[...new Map([...current.refs,...built.sources].map(u=>[outpoint(u),u])).values()],plan:this.plan(built,selected,owner,false,'Resolve old signed request: send BCH back to this wallet; fee '+built.fee+' sats; wait for confirmation before releasing the old reservation'),walletDebit:built.fee.toString()};
  await this.store.save(op);this.reviewed.set(id,{seal:this.seal(op),tip:policy.tip,height:policy.height});return op;
 }
 private async checkRecoveryTarget(op:Operation){
  const target=await this.recoveryTarget(op.recovery!.operationId,op.owner);
  if(this.legacySeal(target.op)!==op.recovery!.seal)throw Error('Old request changed. Inspect it and review resolution again');
  if(!target.op.sources.every(u=>op.sources.some(s=>outpoint(s)===outpoint(u))))throw Error('Resolution does not invalidate the old signed inputs');
  await verifyCoinsAcrossPeers(this.provider,target.refs,true);
  await this.assertNoExistingCovenantFunds(target.op);
 }
 private async finishRecovery(op:Operation){
  const target=await this.recoveryTarget(op.recovery!.operationId,op.owner);
  if(this.legacySeal(target.op)!==op.recovery!.seal)throw Error('Old request changed; retain resolution bytes and inspect both requests');
  if(!target.op.sources.every(u=>op.sources.some(s=>outpoint(s)===outpoint(u))))throw Error('Recovery input identity mismatch');
  try{await this.assertNoExistingCovenantFunds(target.op);}catch(error){if(target.op.supersededBy===op.txid){target.op.supersededBy=undefined;await this.store.save(target.op);}throw error;}
  target.op.stage='conflict';target.op.reservationResolution='conflict';target.op.supersededBy=op.txid;
  target.op.error='Resolved by confirmed wallet self-send '+op.txid+'. Old signed bytes and history retained.';
  await this.store.save(target.op);op.recoveryResolved=true;op.reservationResolution='confirmed';op.error=undefined;
 }
 async reconcileRecovery(id:string){const op=await this.get(id);if(op.step!=='wallet-recovery'||!op.raw)throw Error('No signed resolution to inspect');return this.reconcileReservation(op);}
 async prepare(intent:Intent,keys:WalletKey[],previous?:Operation,continuation?:{id:string;parent:string;completed:number;spentFees:string},discoveryId?:string,creationReview?:'preview'|Operation):Promise<Operation>{
  if(creationReview&&(intent.kind!=='create'||previous||continuation))throw Error('An offline quote can only prepare a new vault');
  if(previous?.network&&previous.network!==this.network())throw Error('Queue journal network mismatch');
  if(previous&&(previous.raw||!['unsigned','rejected'].includes(previous.signing)))throw Error('Uncertain or signed operations cannot be rebuilt');
  if(previous)this.reviewed.delete(previous.id);
  if(intent.kind==='recover')return this.prepareRecovery(intent.operationId,keys,previous);
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner||previous&&previous.owner.publicKey!==owner.publicKey)throw Error('Resume with the original wallet');
  const id=previous?.id??continuation?.id??crypto.randomUUID(),inventory=await this.inventory(keys,id,undefined,discoveryId),coins=inventory.coins;
  if(intent.kind==='create'&&!coins.length){
   const e=inventory.evidence;throw Object.assign(Error(`Insufficient wallet funding. ${e.available} satoshis available; ${e.reserved} satoshis reserved. ${e.reservations.length?'Inspect Transaction recovery. Signed bytes and all reservations are retained.':'No funds found in the checked addresses.'}`),{details:{code:'creation-funding',...e},summary:e.reservations.length?`An old request reserves ${e.reserved} satoshis. Resolve that request to continue creating this new vault.`:'No usable funds found in the checked wallet addresses.'});
  }
  const policy=await this.rate(),rate=policy.rate,authorization=this.authorization(owner);
  let step:Operation['step']='action',built:ReturnType<typeof q.priced>,authorize=true,selected:WalletCoin[]=[],config=previous?.config,offerId=previous?.offerId;let label:string=intent.kind;let quote:CreationQuote|undefined;let reservations:SpendableUtxo[]|undefined;
  if(intent.kind==='create'){
   q.parameters(intent.parameters);
   validateNewTime(intent.parameters.interval,this.network(),'Interval');
   let sequence:ReturnType<typeof creationSequence>;
   try{
    const key=json({parameters:intent.parameters,coins,owner,rate,tip:policy.tip});
    if(discoveryId&&this.preliminary?.scope===discoveryId&&this.preliminary.key===key){sequence=this.preliminary.sequence;this.provider.onTiming?.({stage:'preparation-plan-reused',milliseconds:0,requests:{},ok:true,repeatedRequestsAvoided:1});}
    else {sequence=await timed(this.provider,'preparation-planning',async()=>creationSequence(intent.parameters,coins,owner,this.provider,rate));if(discoveryId)this.preliminary={scope:discoveryId,key,sequence};}
   }catch(error){
    if(!/Insufficient|funding|dust/i.test(errorMessage(error)))throw error;
    const e=inventory.evidence,p=intent.parameters;
    e.eligibleGenesis=coins.filter(c=>!c.utxo.token&&c.utxo.vout===0&&![q.ZERO,p.stakingCategory,p.rewardCategory].includes(c.utxo.txid)).length;
    e.restricted=coins.filter(c=>c.utxo.token&&c.utxo.token.category!==p.rewardCategory).reduce((n,c)=>n+c.utxo.satoshis,0n).toString();
    const required=error instanceof BchFundingError?error.required.toString():undefined;
    const detail={cause:errorMessage(error),code:'creation-funding',inputLimit:16,...e,required,fee:error instanceof BchFundingError?(error.fee+error.preparationFees).toString():undefined,automaticPreparation:'No complete sequence could be funded with the current verified, unreserved inputs.'};
    const failure=Object.assign(new Error(`Vault creation funding: ${!(error instanceof BchFundingError)?errorMessage(error)+'. ':''}${required?`the tested ${error instanceof BchFundingError?error.phase:'sequence'} requires ${required} satoshis (including ${detail.fee} satoshis in measured fees, carriers and non-dust change${error instanceof BchFundingError&&error.phase==='wallet preparation'?'; the later creation fee has not yet been quoted':''}). `:`The reserve and creation carriers alone require at least ${(p.rewardCategory===q.ZERO?p.cap*BigInt(p.releases):q.CARRIER)+2n*q.CARRIER+1000n} satoshis; a complete fee quote is unavailable. `}${e.available} satoshis are available in verified, unreserved wallet inputs across ${e.addresses} supplied addresses; ${e.reserved} satoshis are excluded by unresolved transaction reservations. ${e.eligibleGenesis} eligible genesis UTXOs. ${detail.automaticPreparation} ${e.restricted} satoshis are attached to other fungible token categories and require token-preserving preparation. ${e.reservations.length?'Inspect Transaction recovery: '+e.reservations.map(r=>r.id+' ('+r.step+', '+r.satoshis+' sats): '+r.reason).join('; ')+'. Signed bytes are retained; no automatic rebroadcast or covenant abandonment is performed. ':''}Check that Cashonize exposes the funded wallet addresses, inspect unresolved reservations, or add BCH to this wallet and retry. Plans use at most 16 funding inputs per transaction; consolidate heavily fragmented funds in the wallet if needed. No new transaction was signed during this preflight.`),{details:detail,summary:e.reservations.length?`An old request reserves ${e.reserved} satoshis. Resolve that request to continue creating this new vault.`:`Wallet preparation needs more usable BCH. ${e.available} satoshis are available.`});throw failure;
   }quote=sequence.quote;reservations=coins.filter(c=>sequence.preparations.some(s=>s.selected.includes(c))||sequence.selected.includes(c)).map(c=>c.utxo);
   const first=sequence.preparations[0];authorize=false;
   if(first){built=first.built;selected=first.selected;step='wallet-preparation';config=undefined;label='Prepare wallet with a BCH self-send';}
   else {built=sequence.created;selected=sequence.selected;config={parameters:intent.parameters,identity:sequence.created.context.identity,anchor:{genesis:'',creator:owner.publicKey}};label='Create vault with full reward reserve';}
  }else {
   try{
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
   }catch(error){
    if(!/Insufficient|funding/i.test(errorMessage(error)))throw error;
    const e=inventory.evidence,asset=intent.kind==='insert'?intent.config.parameters.stakingCategory:q.ZERO;
    const eligible=coins.filter(c=>!c.utxo.token||asset!==q.ZERO&&c.utxo.token.category===asset),available=eligible.reduce((n,c)=>n+c.utxo.satoshis,0n).toString();
    throw Object.assign(new Error(`${errorMessage(error)}. ${available} satoshis are available in verified, unreserved inputs eligible for this action across ${e.addresses} supplied addresses; ${e.reserved} satoshis are excluded by unresolved reservations. ${e.reservations.length?'Inspect Transaction recovery before retrying. ':''}Add BCH or the required asset to the connected wallet, check its exposed addresses, then retry. No new transaction was signed during this preflight.`),{details:{code:'action-funding',...e,eligibleAvailable:available,required:error instanceof BchFundingError?error.required.toString():undefined}});
   }
  }
  const tx=built.builder.generateWcTransactionObject().transaction as Transaction,changeScript=binToHex(q.ownerScript(hexToBin(owner.publicKey))),walletDebit=(selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-tx.outputs.filter(o=>binToHex(o.lockingBytecode)===changeScript).reduce((n,o)=>n+o.valueSatoshis,0n)).toString();
  if(['create','insert'].includes(intent.kind))label+='; '+(quote?.transactions??1)+' transactions; '+(quote?.approvals??1)+' wallet approvals; total wallet BCH including fees '+(quote?.walletDebit??walletDebit)+' sats';
  const plan=this.plan(built,selected,owner,authorize,label+'; miner fee '+built.fee+' sats at '+rate+' sat/byte'),op:Operation={id,intent,owner,keys,network:this.network(),quote,reservations,completed:previous?.completed??continuation?.completed??0,spentFees:previous?.spentFees??continuation?.spentFees??'0',parent:previous?.parent??continuation?.parent,approved:!quote||!previous&&quote.transactions===1||!!previous?.approved&&json(previous.quote)===json(quote),step,plan,sources:built.sources,rate,stage:'review',signing:'unsigned',config,offerId,walletDebit};
  // A watch-only quote expires with the page. It cannot reserve inputs, be
  // resumed from history, or carry authorization across a wallet reconnect.
  if(creationReview==='preview')return op;
  const seal=this.seal(op);
  if(creationReview)op.approved=seal===this.seal(creationReview);
  await this.store.save(op);this.reviewed.set(id,{seal,tip:policy.tip,height:policy.height});return op;
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
  else {
   // The accepted complete sequence already reserved its funding. Only its
   // signing keys and self-send destination can fund this continuation.
   const scripts=new Set((op.reservations??op.sources).map(u=>u.lockingBytecode));
   const needed=keys.filter(k=>k.publicKey===op.owner.publicKey||scripts.has(binToHex(q.ownerScript(hexToBin(k.publicKey)))));
   child=await this.prepare(op.intent,needed,undefined,{id:childId,parent:id,completed:(op.completed??0)+1,spentFees:(BigInt(op.spentFees??'0')+BigInt(op.plan.fee!)).toString()});
  }
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
  if(op.quote&&!op.approved)throw Error(op.recovery?'Confirm resolution before signing':'Confirm additional wallet approvals before signing');
  const evidence=this.reviewed.get(id);
  if(!evidence||evidence.seal!==this.seal(op)){this.reviewed.delete(id);throw Error('Transaction intent or wallet session changed; prepare and review again');}
  // Never rediscover funding, traverse the queue, or change the reviewed body.
  // Live availability, ancestry/conflicts and policy still come from both peers.
  op.verifiedAt=undefined;await this.store.save(op);
  try{
   if(op.recovery)await this.checkRecoveryTarget(op);
   const clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true),policy=await this.rate();
   if(policy.tip!==clock.hash)throw Error('Tip changed during authorization; retry verification');
   if(clock.hash!==evidence.tip){
    const movement=await this.provider.session(()=>this.provider.classifyTipChange({hash:evidence.tip,height:evidence.height}),clock.peer);
    if(movement!=='extension')throw Error('Blockchain reorganized; prepare and review again');
   }
   if(policy.rate!==op.rate)throw Error('Fee policy changed; prepare and review again');
   await this.finality(op,op.plan.request.transaction as Transaction,clock);
   op.verifiedAt=Date.now();const authorizedAt=performance.now();await this.store.save(op);evidence.authorizedAt=authorizedAt;return op;
  }catch(e){this.reviewed.delete(id);throw e;}
 }
 async beginSigning(id:string){
  const op=await this.get(id),evidence=this.reviewed.get(id);
  const fresh=()=>!!evidence&&this.reviewed.get(id)===evidence&&evidence.seal===this.seal(op)&&!!op.verifiedAt&&evidence.authorizedAt!==undefined&&Date.now()-op.verifiedAt>=0&&Date.now()-op.verifiedAt<=10000&&performance.now()-evidence.authorizedAt<=10000;
  if(op.raw||!['unsigned','rejected'].includes(op.signing)||!fresh())throw Error('Fresh queue authorization required');
  op.signing='requested';await this.store.save(op);
  if(!fresh()){op.signing='rejected';op.verifiedAt=undefined;await this.store.save(op);throw Error('Fresh queue authorization required');}
  return op;
 }
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
   this.reservePreparationOutputs(op);await this.store.save(op);this.reviewed.delete(id);return op;
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
   if(op.recovery)await this.checkRecoveryTarget(op);
   const clock=await verifyCoinsAcrossPeers(this.provider,op.sources,true),policy=await this.rate(),tx=decodeTransaction(hexToBin(op.raw));if(typeof tx==='string')throw Error(tx);
   if(policy.tip!==clock.hash)throw Error('Tip changed before broadcast; inspect and retry the retained signed transaction');
   if(policy.rate>op.rate)throw Error('Relay fee policy increased after signing; signed bytes and reservations retained. Inspect recovery before requesting another transaction');
   await this.finality(op,tx,clock,async()=>{
    const sent=await this.provider.sendRawTransaction(op.raw!);if(sent!==op.txid)throw Error('Broadcast identity mismatch');
   });
   op.stage='pending';op.error=undefined;await this.store.save(op);return op;
  }catch(e){op.error='Signed bytes retained: '+String(e);await this.store.save(op);throw e;}
 }
 /** Status reconciliation only: never signs, broadcasts or touches covenant funds. */
 private async reconcileReservation(op:Operation){
  op.reservationEvidence=undefined;
  if(op.step==='wallet-recovery')op.recoveryResolved=false;
  if(!op.raw||!op.txid||hashTransaction(hexToBin(op.raw))!==op.txid){op.reservationResolution='unresolved';op.error='Transaction identity is unresolved; inspect retained signed evidence. Reservations retained.';await this.store.save(op);return op;}
  const signed=decodeTransaction(hexToBin(op.raw)),sourcePoints=new Set(op.sources.map(outpoint));
  if(typeof signed==='string'||sourcePoints.size!==op.sources.length||signed.inputs.length!==sourcePoints.size||signed.inputs.some(i=>!sourcePoints.has(binToHex(i.outpointTransactionHash)+':'+i.outpointIndex))){
   op.reservationResolution='unresolved';op.error='Retained signed transaction inputs disagree with the journal sources. A funding parent must not be mistaken for its signed child. Reservations and bytes retained; inspect the original journal before recovery.';await this.store.save(op);return op;
  }
  try{
   const tx=await confirmedWalletTransaction(this.provider,op.txid);
   if(tx.hex.toLowerCase()!==op.raw.toLowerCase())throw Error('Signed transaction evidence mismatch');
   op.stage=tx.confirmations>0?'confirmed':'pending';op.reservationResolution=tx.confirmations>0?'confirmed':'unresolved';
   if(op.step==='wallet-recovery'&&tx.confirmations>0){try{await this.finishRecovery(op);}catch(error){op.recoveryResolved=false;op.error=errorMessage(error);}await this.store.save(op);return op;}
   const decoded=decodeTransaction(hexToBin(op.raw));
   const protectedLegacy=!['action','wallet-preparation'].includes(op.step)&&typeof decoded!=='string'&&decoded.outputs.some(o=>!!o.token?.nft||!/^76a914[a-f0-9]{40}88ac$/.test(binToHex(o.lockingBytecode))&&o.lockingBytecode[0]!==0x6a);
   if(protectedLegacy){op.reservationResolution='unresolved';op.error='Legacy transaction contains covenant, NFT, or other non-wallet outputs. Continuation inputs remain reserved; inspect the retained transaction and legacy continuation before taking further action.';await this.store.save(op);return op;}
   op.error=!['action','wallet-preparation','wallet-recovery'].includes(op.step)?(tx.confirmations>0?'Legacy transaction independently confirmed. Historical signed bytes retained; covenant outputs require separate inspection.':'Legacy transaction is pending. Unspent reserved inputs remain protected.'):undefined;
  }catch{
   const conflict=await this.knownConflict(op).catch(()=>undefined);
   if(conflict){op.stage='conflict';op.reservationResolution='conflict';op.error='Confirmed competing spend '+conflict+' makes the retained transaction unspendable. Signed evidence retained.';}
   else {
    op.stage='signed';op.reservationResolution='unresolved';
    const inputs=op.sources.length?await verifyCoinsAcrossPeers(this.provider,op.sources,true).catch(()=>undefined):undefined;
    if(inputs){
     const bch=op.sources.reduce((n,u)=>n+u.satoshis,0n).toString();op.reservationEvidence={kind:'verified-unspent-inputs',tip:inputs.hash,inputCount:op.sources.length,bch};
     op.error=`Signed transaction ${op.txid} is not independently confirmed. At least two selected-network providers verify its ${op.sources.length} actual signed input(s), totaling ${bch} satoshis, as unspent. Retained signatures could still spend these inputs; a missing transaction response does not cancel them. Reservations remain protected. Inspect the retained legacy request before choosing a recovery; new vault creation needs separate unreserved funding while this request is unresolved. No signing, rebroadcast or abandonment was attempted.`;
    }else op.error='Independent transaction and input status remain inconclusive. Reservations and signed bytes are retained. Inspect the transaction ID and actual signed inputs with selected-network explorers or restore provider connectivity, then Inspect / resume. No rebroadcast or abandonment was attempted.';
   }
  }
  if(op.step==='wallet-recovery'&&!op.recoveryResolved)op.error=op.stage==='conflict'?'The old transaction spent the inputs first. Inspect the old request; this resolution did not release its funds.':op.stage==='pending'?undefined:'Resolution is not confirmed. Its signed bytes and reserved inputs are retained; inspect its status before retrying.';
  await this.store.save(op);return op;
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
 async resume(id:string,keys:WalletKey[],retry=false){const stored=(await this.store.list()).find(o=>o.id===id);if(stored?.step==='wallet-recovery'&&stored.raw){if(stored.owner.publicKey!==keys.find(k=>k.path==='receive'&&k.index===0)?.publicKey)throw Error('Resume with the original wallet');if(stored.network&&stored.network!==this.network())throw Error('Queue journal network mismatch');const checked=await this.reconcileRecovery(id);if(retry&&checked.stage==='signed')return this.broadcast(id);return checked;}
 if(stored&&!['action','wallet-preparation'].includes(stored.step)){if(stored.network&&stored.network!==this.network())throw Error('Queue journal network mismatch');if(stored.owner.publicKey!==keys.find(k=>k.path==='receive'&&k.index===0)?.publicKey)throw Error('Resume with the original wallet');return this.reconcileReservation(stored);}const op=await this.get(id);if(op.owner.publicKey!==keys.find(k=>k.path==='receive'&&k.index===0)?.publicKey)throw Error('Resume with the original wallet');if(!op.raw){if(!['unsigned','rejected'].includes(op.signing))throw Error('Signing status unknown; retain the journal and inspect the wallet before retrying');return this.prepare(op.intent,keys,op);}let tx:any;try{tx=await confirmedWalletTransaction(this.provider,op.txid!);}catch(e){const conflict=await this.knownConflict(op).catch(()=>undefined);if(conflict){op.stage='conflict';op.error='Confirmed competing spend '+conflict+'; signed bytes retained. Start a new request for the current queue position.';await this.store.save(op);return op;}if(retry)return this.broadcast(id);op.error='Signed transaction retained; independent status unavailable';await this.store.save(op);return op;}
  op.stage=tx.confirmations>0?'confirmed':'pending';op.error=undefined;await this.store.save(op);return op;
 }
 async discard(id:string){const op=await this.get(id);if(op.raw||op.signedEvidence||!['unsigned','rejected'].includes(op.signing))throw Error('Signed or uncertain operations remain recoverable');op.stage='discarded';await this.store.save(op);this.reviewed.delete(id);return op;}
}
export class BrowserQueueStore implements Store {
 private db?:Promise<IDBDatabase>;
 constructor(readonly network:string){if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported queue journal network');}
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('staking-arena-queue-'+this.network,1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Queue journal is blocked by another tab'));r.onsuccess=()=>resolve(r.result);});}
 async list(){const db=await this.open();return new Promise<Operation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async save(op:Operation){if(op.network&&op.network!==this.network)throw Error('Queue journal network mismatch');const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(op,op.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}
