import {providerConflictStore} from './providerConflictStore';
import {verifiedProviders} from '../../src/verified-providers';
/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {AssetIndexer} from '../../src/v3/indexer';
import {inspectClaim,RewardClaimer,BrowserClaimStore} from '../../src/v3/claim';
import {AssetWallet,BrowserAssetStore} from '../../src/v3/wallet';
import {v3Config} from './v3Config';
import {walletPeers} from '../../src/electrum-wallet';
// Worker name is immutable for this worker's lifetime; Vite retains the direct worker URL.
const workerEnv:Record<string,string|undefined>=import.meta.env;
const options=v3Config({...workerEnv,VITE_V3_NETWORK:self.name||workerEnv.VITE_V3_NETWORK});
const provider=new BrowserElectrumProvider(options),wallet=new AssetWallet(provider,new BrowserAssetStore(options.network),message=>self.postMessage({type:'progress',message}),report=>self.postMessage({type:'funding-report',report}));
provider.onVerificationProgress=message=>self.postMessage({type:'progress',message});
const scope=self as unknown as DedicatedWorkerGlobalScope;
const conflicts=providerConflictStore(options.network);
let storageFailure=false;
let queue=conflicts.then(async store=>{provider.unresolvedChainPeers=new Set(await store.read());provider.persistChainConflict=async hosts=>{try{await store.save(hosts);}catch(error){storageFailure=true;throw error;}};}).catch(()=>{storageFailure=true;});
scope.onmessage=event=>{queue=queue.catch(()=>{}).then(async()=>{const {id,intent,keys=[]}=event.data;try{
 const run=async()=>{
  if(options.network==='chipnet'&&!['connect','discover','list','claims','sync'].includes(intent.operation))throw Error('Chipnet temporarily unavailable for transactions: consensus/provider conflict; journals retained');
  if(storageFailure&&!['list','claims','discover'].includes(intent.operation))throw Error('Provider conflict evidence unavailable; verification and transactions blocked.');
  if(intent.operation==='connect'){const tip=await verifiedProviders(provider,walletPeers(provider),async()=>{const tip=await provider.tip();return {tip,value:{hash:tip.hash,height:tip.height,endpoint:provider.endpoint},identity:tip.hash};});return {network:options.network,tips:[tip]};}
  if(intent.operation==='discover')throw Error('Public discovery uses the static public index');
  if(intent.operation==='list')return wallet.store.list();
  if(intent.operation==='sync')return inspectClaim(new AssetIndexer(provider,intent.config));
  if(intent.operation==='claim')return wallet.claim(intent.config,keys);
  if(intent.operation==='reconcileClaim')return new RewardClaimer(new AssetIndexer(provider,intent.config),new BrowserClaimStore(options.network)).reconcile(intent.id,false);
  if(intent.operation==='claims')return new BrowserClaimStore(options.network).list();
  if(intent.operation==='createLegacy')return wallet.createLegacy(intent.parameters,keys);
  if(intent.operation==='create')return wallet.create(intent.parameters,keys);
  if(intent.operation==='offer')return wallet.offer(intent.config,intent.terms,keys);
  if(intent.operation==='action')return wallet.action(intent.config,intent.action,intent.slot,keys);
  if(intent.operation==='withdraw')return wallet.withdraw(intent.config,intent.allocation,keys);
  if(intent.operation==='resume'||intent.operation==='inspect')return wallet.resume(intent.id);
  if(intent.operation==='signingFailed')return wallet.signingFailed(intent.id,String(intent.error),intent.rejected===true);
  if(intent.operation==='authorize')return wallet.authorize(intent.id);
  if(intent.operation==='retainAtomicSigned')return wallet.retainAtomicSigned(intent.id,intent.raw);
  if(intent.operation==='submit')return wallet.submit(intent.id,intent.raw);
  if(intent.operation==='rebroadcast')return wallet.rebroadcast(intent.id);
  if(intent.operation==='rebroadcastFunding')return wallet.rebroadcastFunding(intent.id);
  if(intent.operation==='discard')return wallet.discard(intent.id);
  throw Error('Unknown v3 operation');
 };
 if(!scope.navigator.locks)throw Error('V3 requires Web Locks');
 if(intent.operation==='sync'){const store=await conflicts;for(const host of await store.read())provider.unresolvedChainPeers.add(host);const result=await run();scope.postMessage({id,result});return;}
 const store=await conflicts;for(const host of await store.read())provider.unresolvedChainPeers.add(host);
 const result=await scope.navigator.locks.request(`arena-${options.network}-v3`,{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is updating v3');return run();});scope.postMessage({id,result});
 }catch(e){scope.postMessage({id,error:String(e)});}});};
scope.postMessage({type:'ready'});
