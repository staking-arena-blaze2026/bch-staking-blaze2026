import {timed} from '../../src/operation-timing';
import {errorMessage} from '../../src/queue/funding';
/// <reference lib="webworker" />
import {ElectrumTransportError} from '../../src/electrum-core';
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {emptyQueueIndex,scanQueueIndex} from '../../src/queue/public-index';
import {confirmedWalletTransaction} from '../../src/electrum-wallet';
import {QueueIndexer} from '../../src/queue/chain';
import {QueueWallet,BrowserQueueStore} from '../../src/queue/wallet';
import {v3Config} from './v3Config';
import {providerConflictStore} from './providerConflictStore';
import {queueArchiveStore} from './queueArchiveStore';
const workerEnv:Record<string,string|undefined>=import.meta.env;
const options=v3Config({...workerEnv,VITE_V3_NETWORK:self.name.split(':')[0]}),readOnly=self.name.endsWith(':read');
if(readOnly)options.allowBroadcast=false;
const provider=new BrowserElectrumProvider(options),store=new BrowserQueueStore(options.network),wallet=new QueueWallet(provider,store),scope=self as unknown as DedicatedWorkerGlobalScope;
const publicScan=emptyQueueIndex(options.network);
const displayIndexers=new Map<string,QueueIndexer>();
let failure=false;
const messages:Record<string,string>={'preparation-planning':'Calculating the fastest vault-creation path','wallet-input-verification':'Checking wallet inputs and ancestry','prepare':'Calculating the fastest vault-creation path','wallet-address-discovery':'Finding available wallet funds','independent-provider-verification':'Verifying blockchain information on independent providers','legacy-reservation-reconciliation':'Checking relevant old wallet requests','fee-policy':'Checking current verified fee policy','authorize':'Checking wallet inputs before signing','retain':'Verifying signed transaction','submit':'Broadcasting transaction','advance':'Verifying preparation and preparing the next transaction'};
let stage='Verifying blockchain information';
provider.onStage=value=>{stage=messages[value]??'Checking transaction recovery';scope.postMessage({type:'progress',message:stage});};
provider.onTiming=timing=>scope.postMessage({type:'timing',timing});
provider.onVerificationProgress=message=>scope.postMessage({type:'progress',message});
const conflictReady=providerConflictStore(options.network).then(async s=>{provider.unresolvedChainPeers=new Set(await s.read());provider.persistChainConflict=async peers=>{try{await s.save(peers);}catch(e){failure=true;throw e;}};}).catch(()=>{failure=true;});
function frames(error:unknown) {
 return import.meta.env.DEV&&error instanceof Error?error.stack?.split('\n').slice(1,9).filter(line=>/^\s+at /.test(line)).join('\n'):undefined;
}
scope.addEventListener('unhandledrejection', event=>{
 event.preventDefault();
 scope.postMessage({type:'fatal',frames:frames(event.reason)});
});
let pending:Promise<void>=Promise.resolve();
scope.onmessage=event=>{pending=pending.catch(()=>{}).then(async()=>{const {id,intent,keys=[]}=event.data;const heartbeat=readOnly?undefined:setInterval(()=>scope.postMessage({type:'heartbeat',id,message:'Still checking blockchain information: '+stage}),5000);try{
 const operation=String(intent.operation),reading=['list','reportedQueue','owned','discover','creationStatus'].includes(operation);
 if(readOnly&&!reading)throw Error('Read-only queue worker cannot sign, journal or broadcast');
 if(!['list','discover','reportedQueue'].includes(operation)){
  await conflictReady;
  if(failure)throw Error('Provider conflict evidence is unavailable');
 }
 const run=async()=>{let result;
 if(operation==='invalidate')result=wallet.invalidateReviews();
 else if(operation==='list')result=await store.list();
 else if(operation==='discover'){
  const summary=await scanQueueIndex(publicScan,provider,12000,new Set<string>(intent.published));
  result={...summary,vaults:Object.values(publicScan.vaults)};
 }
 else if(operation==='creationStatus'){
  const tx=await confirmedWalletTransaction(provider,intent.txid);
  result={confirmed:tx.confirmations>0};
 }
 else if(operation==='reportedQueue'){
  const key=JSON.stringify(intent.config,(_,value)=>typeof value==='bigint'?value.toString():value);
  const index=displayIndexers.get(key)??new QueueIndexer(provider,intent.config);
  displayIndexers.delete(key);displayIndexers.set(key,index);
  if(displayIndexers.size>40)displayIndexers.delete(displayIndexers.keys().next().value!);
  result=await index.reportedDisplay(intent.clock===true,true);
 }
 else if(operation==='owned'){
  const {config,owner}=intent;
  const cached=await queueArchiveStore(options.network).then(store=>store.read(config,owner)).catch(()=>undefined);
  const indexed=await new QueueIndexer(provider,config).archive(owner,cached?.checkpoint);
  await queueArchiveStore(options.network).then(store=>store.save(config,owner,indexed)).catch(()=>{});
  result=indexed.rows;
 }
 else if(operation==='previewCreate')result=await wallet.prepare(intent.intent,keys,undefined,undefined,intent.discoveryId,'preview');
 else if(operation==='acceptCreateReview')result=await wallet.prepare(intent.draft.intent,keys,undefined,undefined,undefined,intent.draft);
 else if(operation==='prepare')result=await wallet.prepare(intent.intent,keys,undefined,undefined,intent.discoveryId);
 else if(operation==='advance')result=await wallet.advance(intent.id,keys);
 else if(operation==='reconcileRecovery')result=await wallet.reconcileRecovery(intent.id);
 else if(operation==='confirm')result=await wallet.confirm(intent.id);
 else if(operation==='authorize')result=await wallet.authorize(intent.id);
 else if(operation==='retain')result=await wallet.retain(intent.id,intent.raw);
 else if(operation==='beginSigning')result=await wallet.beginSigning(intent.id);
 else if(operation==='signingFailed')result=await wallet.signingFailed(intent.id,intent.rejected===true,intent.notRequested===true);
 else if(operation==='submit')result=await wallet.broadcast(intent.id);
 else if(operation==='resume')result=await wallet.resume(intent.id,keys,intent.retry===true);
 else if(operation==='discard')result=await wallet.discard(intent.id);
 else throw Error('Unsupported queue operation');
 return result;};
 if(!reading&&!scope.navigator.locks)throw Error('Queue transactions require Web Locks');
 const result=reading?await run():await scope.navigator.locks.request('arena-'+options.network+'-queue',{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is updating this queue wallet');return timed(provider,operation,run);});
 scope.postMessage({id,result});
 }catch(error){scope.postMessage({id,error:errorMessage(error),category:error instanceof ElectrumTransportError?'electrum-transport':undefined,transportReason:error instanceof ElectrumTransportError?`lost its Electrum connection (${error.reason})`:undefined,frames:frames(error),summary:(error as {summary?:string})?.summary,details:(error as {details?:unknown})?.details});}finally{clearInterval(heartbeat);}});};

scope.postMessage({type:'ready'});
