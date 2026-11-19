import {timed} from '../../src/operation-timing';
import {errorMessage} from '../../src/queue/funding';
/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {emptyQueueIndex,scanQueueIndex} from '../../src/queue/public-index';
import {confirmedWalletTransaction} from '../../src/electrum-wallet';
import {QueueIndexer} from '../../src/queue/chain';
import {QueueWallet,BrowserQueueStore} from '../../src/queue/wallet';
import {v3Config} from './v3Config';
import {providerConflictStore} from './providerConflictStore';
import {WalletDiscoveryStore} from './walletDiscoveryStore';
const workerEnv:Record<string,string|undefined>=import.meta.env;
const options=v3Config({...workerEnv,VITE_V3_NETWORK:self.name.split(':')[0]}),readOnly=self.name.endsWith(':read');
if(readOnly)options.allowBroadcast=false;
const provider=new BrowserElectrumProvider(options),store=new BrowserQueueStore(options.network),wallet=new QueueWallet(provider,store),scope=self as unknown as DedicatedWorkerGlobalScope;
const publicScan=emptyQueueIndex(options.network);
let failure=false;
const warmProvider=readOnly?undefined:new BrowserElectrumProvider({...options,allowBroadcast:false});
const discoveryStore=readOnly?undefined:new WalletDiscoveryStore(options.network,provider.endpoints);
let discoveryOwner='',discoveryLoad:Promise<unknown>=Promise.resolve();
function loadDiscovery(id:string){
 if(!discoveryStore||!/^[a-f0-9]{64}$/.test(id))return Promise.resolve([]);
 if(discoveryOwner===id)return discoveryLoad;
 discoveryOwner=id;
 discoveryLoad=discoveryStore.load(id).then(saved=>{
  if(discoveryOwner!==id||!saved)return [];
  const funded=wallet.restoreDiscovery(id,saved.scope,saved.evidence);
  return [...new Map([...saved.keys,...funded].map(key=>[key.path+':'+key.index,key])).values()];
 }).catch(()=>[]);
 return discoveryLoad;
}
function persistDiscovery(id:string,invalidate=false,background=false){
 if(id&&id===discoveryOwner)void discoveryStore?.save(id,wallet.discoverySnapshot(id,background),invalidate).catch(()=>{});
}
const messages:Record<string,string>={'preparation-planning':'Calculating the fastest vault-creation path','wallet-input-verification':'Checking wallet inputs and ancestry','previewCreate':'Estimating vault-creation costs','prepare':'Calculating the fastest vault-creation path','wallet-address-discovery':'Finding available wallet funds','independent-provider-verification':'Verifying blockchain information on independent providers','legacy-reservation-reconciliation':'Checking relevant old wallet requests','fee-policy':'Checking current verified fee policy','authorize':'Checking wallet inputs before signing','retain':'Verifying signed transaction','submit':'Broadcasting transaction','advance':'Verifying preparation and preparing the next transaction'};
let stage='Verifying blockchain information';
provider.onStage=value=>{stage=messages[value]??'Checking transaction recovery';scope.postMessage({type:'progress',message:stage});};
provider.onTiming=timing=>scope.postMessage({type:'timing',timing});
provider.onVerificationProgress=message=>{scope.postMessage({type:'progress',message});};
let pending=providerConflictStore(options.network).then(async s=>{provider.unresolvedChainPeers=new Set(await s.read());provider.persistChainConflict=async peers=>{try{await s.save(peers);}catch(e){failure=true;throw e;}};}).catch(()=>{failure=true;});
scope.onmessage=event=>{
 const {id,intent,keys=[]}=event.data;
 if(intent.operation==='loadDiscovery'&&discoveryStore){
  void loadDiscovery(intent.discoveryId).then(result=>scope.postMessage({id,result}));
  return;
 }
 if(intent.operation==='warmDiscovery'&&warmProvider){
  const owner=intent.discoveryId;
  void wallet.warmDiscovery(keys,owner,warmProvider,intent.refresh===true).then(
   result=>{if(result)persistDiscovery(owner,false,true);scope.postMessage({id,result});},
   error=>scope.postMessage({id,error:errorMessage(error)}));
  return;
 }
 if(['prepare','previewCreate','invalidate'].includes(intent.operation))wallet.cancelWarmDiscovery();
 if(intent.operation==='invalidate'){discoveryOwner='';discoveryLoad=Promise.resolve();}
 pending=pending.catch(()=>{}).then(async()=>{const heartbeat=setInterval(()=>scope.postMessage({type:'heartbeat',id,message:'Still checking blockchain information: '+stage}),5000);try{
 const operation=String(intent.operation),reading=['list','sync','owned','discover','creationStatus','previewCreate'].includes(operation);
 if(readOnly&&!reading)throw Error('Read-only queue worker cannot sign, journal or broadcast');
 if(failure&&!['list','discover'].includes(operation))throw Error('Provider conflict evidence is unavailable');
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
 else if(operation==='sync')result=await new QueueIndexer(provider,intent.config).sync();
 else if(operation==='owned')result=await new QueueIndexer(provider,intent.config).owned(intent.owner);
 else if(operation==='previewCreate')result=await timed(provider,operation,()=>wallet.previewCreate(intent.parameters,keys,intent.discoveryId,intent.atomicOnly===true,intent.firstBatch===true));
 else if(operation==='prepare')result=await wallet.prepare(intent.intent,keys,undefined,undefined,intent.discoveryId,intent.atomicOnly===true,intent.firstBatch===true,intent.reviewedCommitment);
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
 if(['previewCreate','prepare','authorize','submit'].includes(operation))persistDiscovery(discoveryOwner);
 scope.postMessage({id,result});
 }catch(error){if(['authorize','submit'].includes(intent.operation)||['previewCreate','prepare'].includes(intent.operation)&&/conflict|reorg|provider|tip changed/i.test(String(error)))persistDiscovery(discoveryOwner,true);scope.postMessage({id,error:errorMessage(error),summary:(error as {summary?:string})?.summary,details:(error as {details?:unknown})?.details});}finally{clearInterval(heartbeat);}});};

scope.postMessage({type:'ready'});
