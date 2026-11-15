/// <reference lib="webworker" />
import {BrowserElectrumProvider} from '../../src/electrum-wss';
import {AssetIndexer} from '../../src/v3/indexer';
import {inspectClaim,RewardClaimer,BrowserClaimStore} from '../../src/v3/claim';
import {AssetWallet,BrowserAssetStore} from '../../src/v3/wallet';
import {v3Config} from './v3Config';
import {walletPeers} from '../../src/electrum-wallet';
const options=v3Config();
const provider=new BrowserElectrumProvider(options),wallet=new AssetWallet(provider,new BrowserAssetStore(options.network),message=>self.postMessage({type:'progress',message}),report=>self.postMessage({type:'funding-report',report}));
const scope=self as unknown as DedicatedWorkerGlobalScope;
let queue=Promise.resolve();
scope.onmessage=event=>{queue=queue.catch(()=>{}).then(async()=>{const {id,intent,keys=[]}=event.data;try{
 const run=async()=>{
  if(intent.operation==='connect'){const tips=[];for(const peer of walletPeers(provider))tips.push(await provider.session(async()=>{const tip=await provider.tip();return {hash:tip.hash,height:tip.height,endpoint:provider.endpoint};},peer));if(tips[0]!.hash!==tips[1]!.hash)throw Error('V3 providers disagree on tip; refresh');return {network:options.network,tips};}
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
 const result=await scope.navigator.locks.request(`arena-${options.network}-v3`,{ifAvailable:true},async lock=>{if(!lock)throw Error('Another tab is updating v3');return run();});scope.postMessage({id,result});
 }catch(e){scope.postMessage({id,error:String(e)});}});};
scope.postMessage({type:'ready'});
