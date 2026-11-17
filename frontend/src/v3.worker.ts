import {validateNewTime} from '../../src/v3/time-policy';
import {reconcileAtomicOffer} from '../../src/v3/offer-status';
import {timed} from '../../src/operation-timing';
import {providerConflictStore} from './providerConflictStore';
import {verifiedProviders} from '../../src/verified-providers';
/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {AssetIndexer} from '../../src/v3/indexer';
import {describeSnapshot,RewardClaimer,BrowserClaimStore} from '../../src/v3/claim';
import {AssetWallet,BrowserAssetStore} from '../../src/v3/wallet';
import {v3Config} from './v3Config';
import {walletPeers} from '../../src/electrum-wallet';
// Worker name is immutable for this worker's lifetime; Vite retains the direct worker URL.
const workerEnv:Record<string,string|undefined>=import.meta.env;
const readOnly=self.name.endsWith(':read');
const options=v3Config({...workerEnv,VITE_V3_NETWORK:self.name.split(':')[0]||workerEnv.VITE_V3_NETWORK});
if(readOnly)options.allowBroadcast=false;
let activeId:number|undefined;let activeOperation='';
const stage=(name:string)=>self.postMessage({type:'stage',id:activeId,stage:name});
const provider=new BrowserElectrumProvider(options),store=new BrowserAssetStore(options.network),wallet=new AssetWallet(provider,{list:()=>store.list(),save:op=>timed(provider,'journal-write',()=>store.save(op))},message=>{if(message.startsWith('Broadcasting'))stage('broadcast');self.postMessage({type:'progress',id:activeId,message});},report=>self.postMessage({type:'funding-report',id:activeId,report}));
provider.onStage=stage;
provider.onTiming=timing=>self.postMessage({type:'timing',id:activeId,timing});
provider.onVerificationProgress=message=>self.postMessage({type:'progress',id:activeId,message});
const scope=self as unknown as DedicatedWorkerGlobalScope;
const conflicts=providerConflictStore(options.network);
let storageFailure=false;
let queue=conflicts.then(async store=>{provider.unresolvedChainPeers=new Set(await store.read());provider.persistChainConflict=async hosts=>{try{await store.save(hosts);}catch(error){storageFailure=true;throw error;}};}).catch(()=>{storageFailure=true;});
scope.onmessage=event=>{queue=queue.catch(()=>{}).then(async()=>{const {id,intent,keys=[],enqueuedAt}=event.data;activeId=id;activeOperation=intent.operation;stage(activeOperation);self.postMessage({type:'timing',id,timing:{stage:'worker-queue',milliseconds:Math.max(0,Date.now()-enqueuedAt),requests:{},ok:true}});try{
 const run=async()=>{
  if(readOnly&&!['connect','sync','list','claims','inspectRead'].includes(intent.operation))throw Error('Read worker cannot change transaction journals or submit transactions');
  if(storageFailure&&!['list','claims','discover','discard'].includes(intent.operation))throw Error('Provider conflict evidence unavailable; verification and transactions blocked.');
  if(intent.operation==='connect'){const tip=await verifiedProviders(provider,walletPeers(provider),async()=>{const tip=await provider.tip();return {tip,value:{hash:tip.hash,height:tip.height,endpoint:provider.endpoint},identity:tip.hash};});return {network:options.network,tips:[tip]};}
  if(intent.operation==='discover')throw Error('Public discovery uses the static public index');
  if(intent.operation==='list')return wallet.store.list();
  if(intent.operation==='inspectRead'){
   const original=(await wallet.store.list()).find(o=>o.id===intent.id);
   if(!original?.raw||!['direct','chained'].includes(original.creationMode??'')&&original.registrationMode!=='atomic')throw Error('Read-only inspection requires a signed direct, chained or atomic operation');
   const copy=structuredClone(original),preview=new AssetWallet(provider,{list:async()=>[copy],save:async()=>{}});
   return {original,result:await preview.resume(original.id)};
  }
  if(intent.operation==='applyInspection'){
   const current=(await wallet.store.list()).find(o=>o.id===intent.original.id);
   const encode=(v:unknown)=>JSON.stringify(v,(_,value)=>typeof value==='bigint'?value.toString():value);
   if(current&&intent.result.id===current.id&&encode(current)===encode(intent.original))await wallet.store.save({...current,step:intent.result.step,stage:intent.result.stage,confirmations:intent.result.confirmations,observation:intent.result.observation,verifiedAt:intent.result.verifiedAt,error:intent.result.error,config:intent.result.config});
   return current;
  }
  if(intent.operation==='sync'){
   let displayed=false;
   const index=new AssetIndexer(provider,intent.config);
   const snapshot=await index.sync(readOnly ? snapshot=>{if(!displayed){displayed=true;scope.postMessage({type:'display-snapshot',id,result:describeSnapshot(snapshot)});}} : undefined);
   const result=describeSnapshot(snapshot);
   const originals=(await wallet.store.list()).filter(op=>op.registrationMode==='atomic'&&op.raw&&op.txid&&op.config?.genesis===intent.config.genesis);
   return {...result,inspections:originals.map(original=>({original,result:reconcileAtomicOffer(original,result.snapshot)}))};
  }
  if(intent.operation==='claim')return wallet.claim(intent.config,keys);
  if(intent.operation==='reconcileClaim')return new RewardClaimer(new AssetIndexer(provider,intent.config),new BrowserClaimStore(options.network)).reconcile(intent.id,false);
  if(intent.operation==='claims')return new BrowserClaimStore(options.network).list();
  if(intent.operation==='createLegacy')return wallet.createLegacy(intent.parameters,keys);
  if(intent.operation==='create'){validateNewTime(intent.parameters.periodSeconds,options.network,'Interval');return wallet.create(intent.parameters,keys);}
  if(intent.operation==='offer'){validateNewTime(intent.terms.duration,options.network,'Duration');return wallet.offer(intent.config,intent.terms,keys);}
  if(intent.operation==='action')return wallet.action(intent.config,intent.action,intent.slot,keys);
  if(intent.operation==='withdraw')return wallet.withdraw(intent.config,intent.allocation,keys);
  if(intent.operation==='resume'||intent.operation==='inspect')return wallet.resume(intent.id);
  if(intent.operation==='signingFailed')return wallet.signingFailed(intent.id,String(intent.error),intent.rejected===true);
  if(intent.operation==='authorize')return wallet.authorize(intent.id);
  if(intent.operation==='retainSigned')return wallet.retainSigned(intent.id,intent.raw);
  if(intent.operation==='retainAtomicSigned')return wallet.retainAtomicSigned(intent.id,intent.raw);
  if(intent.operation==='submit')return wallet.submit(intent.id,intent.raw);
  if(intent.operation==='rebroadcast')return wallet.rebroadcast(intent.id);
  if(intent.operation==='rebroadcastFunding')return wallet.rebroadcastFunding(intent.id);
  if(intent.operation==='discard')return wallet.discard(intent.id);
  throw Error('Unknown v3 operation');
 };
 if(!scope.navigator.locks)throw Error('V3 requires Web Locks');
 if(['sync','connect','list','claims','inspectRead'].includes(intent.operation)){const store=await conflicts;for(const host of await store.read())provider.unresolvedChainPeers.add(host);const result=await timed(provider,activeOperation,run);scope.postMessage({id,result});return;}
 const store=await conflicts;for(const host of await store.read())provider.unresolvedChainPeers.add(host);
 const result=await scope.navigator.locks.request(`arena-${options.network}-v3`,{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is updating v3');return timed(provider,activeOperation,run);});scope.postMessage({id,result});
 }catch(e){scope.postMessage({id,error:String(e)});}finally{activeId=undefined;}});};
scope.postMessage({type:'ready'});
