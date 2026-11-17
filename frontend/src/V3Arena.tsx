import {MyOffers} from './MyOffers';
import {lastOfferOwner,rememberOfferOwner} from './offerIdentity';
import {canDiscardUnsigned,blocksVault} from '../../src/v3/recovery-policy';
import {ownedOffers,offerActionIntent} from '../../src/v3/my-offers';
import {restoreWalletRequest,offerRequestState} from './walletRequest';
import {SubmittedOffers} from './SubmittedOffers';
import {offerDisplayStatus,OFFER_RETRY_DELAYS} from '../../src/v3/offer-status';
import type {FundingReport} from '../../src/v3/funding-report';
import {v3Chain,v3ConfigStorage} from './v3Config';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Buffer} from '../../src/bytes';
import {records,rankings} from '../../src/arena-core';
import {validateParameters,rewardRemaining,buffer,releaseCount,exactPriority,allocationSequence,type Asset,type Parameters} from '../../src/v3/model';
import {validateNewOffer} from '../../src/v3/offer-policy';
import type {Config,Snapshot} from '../../src/v3/indexer';
import type {Operation} from '../../src/v3/wallet';
import type {ClaimRecord} from '../../src/v3/claim';
import {marketAsset,marketReward} from './marketplaceDisplay';
import {assetLabel,assetAmount,assetInputUnits} from './createAssets';
import {v3Call,verifyMarketplace,cancelMarketplaceReads} from './v3Client';
import {loadPublicPage,retainedCandidates,retainCandidates} from './publicVaultIndex';
import {useWalletTransactions} from './walletTransactions';
const encode=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2),storage=v3ConfigStorage;
export function parseV3(text:string):Config{const c=JSON.parse(text);c.cap=BigInt(c.cap);validateParameters(c);if(!/^[a-f0-9]{64}$/.test(c.genesis))throw Error('Invalid genesis ID');return c;}
function saved():Config[]{try{return JSON.parse(localStorage.getItem(storage)??'[]').flatMap((c:Config)=>{try{return [parseV3(encode(c))];}catch{return [];}});}catch{return [];}}
function save(c:Config){localStorage.setItem(storage,encode([c,...saved().filter(x=>x.genesis!==c.genesis)]));}
function loadDisplaySnapshots(key:string):Record<string,{snapshot?:Snapshot;error?:string;at:number}>{
 const result:Record<string,{snapshot?:Snapshot;error?:string;at:number}>={};
 try{const values=JSON.parse(localStorage.getItem(key)??'{}');for(const [id,row]of Object.entries(values) as [string,any][]){try{
  const v=row.snapshot;if(!v||v.config.genesis!==id)continue;
  v.config=parseV3(encode(v.config));v.instance.state=Buffer.from(v.instance.state.data??v.instance.state);
  if(v.instance.state.length!==794||v.instance.state[5]>16||!Number.isFinite(v.clock.mtp)||!Array.isArray(v.pending)||!Array.isArray(v.allocations))continue;
  rewardRemaining(v.instance.state);rankings(v.instance.state,false);
  for(const a of v.allocations)a.terms=Buffer.from(a.terms.data??a.terms);
  result[id]={snapshot:v,at:Number.isFinite(row.at)?row.at:0,error:'Verification temporarily unavailable — stale, non-authoritative snapshot'};
 }catch{/* A damaged display row cannot erase configurations or other snapshots. */}}}catch{/* Display cache is optional and never authoritative. */}
 return result;
}
export default function V3Arena(){
 const [route,setRoute]=useState(()=>window.location.hash),[catalog,setCatalog]=useState<Config[]>(()=>retainedCandidates(v3Chain).map(c=>c.config)),[discoveryError,setDiscoveryError]=useState('');
 const [indexReady,setIndexReady]=useState(false);
 const cacheKey=storage+'-snapshots';
 const [listings,setListings]=useState<Record<string,{snapshot?:Snapshot;error?:string;at:number}>>(()=>loadDisplaySnapshots(cacheKey));
 const listingsRef=useRef(listings);listingsRef.current=listings;
 const [page,setPage]=useState(0),[discoveryCursor,setDiscoveryCursor]=useState<string>(),[discovering,setDiscovering]=useState(false);
 useEffect(()=>{try{localStorage.setItem(cacheKey,encode(listings));}catch{/* Storage availability does not affect journal storage or verification. */}},[listings]);
 const selectedId=route.match(/^#\/v3\/vault\/([a-f0-9]{64})$/i)?.[1]?.toLowerCase(),creating=route==='#/v3',myOffers=route==='#/v3/my-offers';

 useLayoutEffect(()=>{if(indexReady||creating||selectedId)document.getElementById('arena-public-preview')?.remove();},[indexReady,creating,selectedId]);
 const wallet=useWalletTransactions(),[configs,setConfigs]=useState(saved),[verified,setVerified]=useState<any>(),[updated,setUpdated]=useState(0),[now,setNow]=useState(Date.now()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ops,setOps]=useState<Operation[]>([]),[claims,setClaims]=useState<ClaimRecord[]>([]),[showPending,setShowPending]=useState(true);
 const known=[...new Map([...configs,...catalog].map(c=>[c.genesis,c])).values()],visibleKnown=myOffers?known:known.slice(page*20,(page+1)*20);
 const [stakeKind,setStakeKind]=useState('bch'),[rewardKind,setRewardKind]=useState('bch'),[stakeCategory,setStakeCategory]=useState(''),[rewardCategory,setRewardCategory]=useState(''),[release,setRelease]=useState('0.00002000'),[interval,setInterval]=useState('3600'),[count,setCount]=useState('10'),[epoch,setEpoch]=useState(new Date(Date.now()+3600000).toISOString().slice(0,19));
 const [funding,setFunding]=useState<FundingReport>();
 useEffect(()=>{setFunding(undefined);},[wallet]);
 useEffect(()=>{const report=(event:Event)=>setFunding((event as CustomEvent).detail);window.addEventListener('arena-funding-report',report);return()=>window.removeEventListener('arena-funding-report',report);},[]);
 const [s,setS]=useState('0.00003000'),[t,setT]=useState('3600'),[r,setR]=useState('0.00001000');
 const [networkStatus,setNetworkStatus]=useState('Verifying '+v3Chain+' providers…');
 const walletAvailability=wallet?.v3Availability?.(),walletReady=!!wallet?.v3&&(walletAvailability?.available??true);
 const walletRef=useRef(wallet);walletRef.current=wallet;
 const requestLifetime=useRef(new AbortController());
 useEffect(()=>{requestLifetime.current=new AbortController();return()=>requestLifetime.current.abort();},[]);
 const pairedOffline=!!wallet?.pairing?.().paired&&!wallet.pairing().live;
 const canRequest=walletReady||pairedOffline;
 const requestedVault=useRef<string|undefined>(undefined),running=useRef(false),[actionMessage,setActionMessage]=useState<{key:string;text:string;txid?:string}>();
 const [display,setDisplay]=useState<any>();
 useEffect(()=>{
  const receive=(event:Event)=>{
   const value=(event as CustomEvent).detail;
   if(value.snapshot.config.genesis!==selectedId)return;
   value.snapshot.instance.state=Buffer.from(value.snapshot.instance.state);
   for(const a of value.snapshot.allocations)a.terms=Buffer.from(a.terms);
   setDisplay({...value,observedAt:Date.now()});
  };
  window.addEventListener('arena-vault-display',receive);
  return()=>window.removeEventListener('arena-vault-display',receive);
 },[selectedId]);
 const independentlyVerified=!!updated&&verified?.snapshot?.config.genesis===selectedId;
 const shown=verified?.snapshot?.config.genesis===selectedId?verified:display?.snapshot?.config.genesis===selectedId?display:undefined;
 const snapshot:Snapshot|undefined=shown?.snapshot,stale=now-updated>30000;
 const [lastOwner,setLastOwner]=useState(()=>lastOfferOwner());
 let owner='';try{if(walletReady)owner=wallet!.publicKey();}catch{/* Live wallet checks also run before signing. */}
 useEffect(()=>{if(owner){rememberOfferOwner(owner);setLastOwner(owner);}},[owner]);
 const selectedOwner=owner||lastOwner;
 const selectedOwnerRef=useRef(selectedOwner);selectedOwnerRef.current=selectedOwner;
 const pendingOperation=ops.find(o=>o.config?.genesis===snapshot?.config.genesis&&blocksVault(o)&&!(o.raw&&o.step==='action'&&[...(snapshot?.history??[]),...(snapshot?.pendingHistory??[])].includes(o.txid??'')));
 const stateReason=busy?'operation in progress':!independentlyVerified?'Independent verification incomplete':snapshot?.pending.length?'competing vault transaction pending':pendingOperation?(pendingOperation.raw||pendingOperation.fundingRaw?'Awaiting automatic verification of the signed '+pendingOperation.kind+' transaction. Signed evidence is retained in Transaction recovery.':'An unsigned '+pendingOperation.kind+' operation awaits wallet approval or unsigned cancellation in Transaction recovery'):'';
 const walletReason='connect a compatible WizardConnect/Cashonize wallet on the selected network. '+(walletAvailability?.reason??'');
 const feedback=(key:string)=>{
  if(actionMessage?.key!==key)return null;
  const id=actionMessage.txid,confirmed=id&&snapshot?.history?.includes(id),pending=id&&snapshot?.pendingHistory?.includes(id);
  const local=id?ops.find(o=>o.txid===id):undefined;
  const text=key==='offer'&&updated&&snapshot?.config.genesis===selectedId&&(confirmed||pending)?`Offer independently verified — ${confirmed?'Confirmed':'Pending (0-conf)'}. Transaction ${id}. Live queue updated.`:key==='offer'&&local?offerDisplayStatus(local)+`. Transaction ${id??'not signed'}.`:actionMessage.text;
  return <p aria-live="polite">{text}</p>;
 };
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);void v3Call({operation:'connect'}).then(result=>setNetworkStatus(result?.network===v3Chain?`${v3Chain} providers verified · height ${result.tips[0].height}`:'Provider verification unavailable')).catch(error=>setNetworkStatus('Provider verification unavailable: '+String(error)));void loadOperations().catch(e=>setMessage(String(e)));return()=>window.clearInterval(timer);},[]);

 useEffect(()=>{const changed=()=>setRoute(window.location.hash);window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
 const indexAbort=useRef<AbortController|undefined>(undefined),indexPages=useRef<string[]>([]);
 const discoveryRunning=useRef(false);
 async function discover(cursor?:string){if(discoveryRunning.current)return;discoveryRunning.current=true;setDiscovering(true);const controller=new AbortController();indexAbort.current=controller;
 try{const value=await loadPublicPage(v3Chain,cursor??'index.json',controller.signal);if(controller.signal.aborted)return;
 setCatalog(old=>{const fresh=value.vaults.map(c=>c.config),ids=new Set(fresh.map(c=>c.genesis)),retained=old.filter(c=>!ids.has(c.genesis));return cursor?[...retained,...fresh]:[...fresh,...retained];});
 if(!cursor){indexPages.current=value.pages;retainCandidates(v3Chain,value.vaults);}else indexPages.current=indexPages.current.filter(p=>p!==cursor);
 setDiscoveryCursor(indexPages.current[0]);setDiscoveryError('');
 }catch(e){if(!controller.signal.aborted)setDiscoveryError('Public discovery unavailable. Showing retained vaults; try refreshing.');}finally{if(!controller.signal.aborted){discoveryRunning.current=false;setDiscovering(false);setIndexReady(true);}}}
 const myOfferPages=useRef(new Set<string>());
 useEffect(()=>{if(myOffers&&discoveryCursor&&!discovering&&!myOfferPages.current.has(discoveryCursor)){myOfferPages.current.add(discoveryCursor);void discover(discoveryCursor);}},[myOffers,discoveryCursor,discovering]);
 useEffect(()=>{void discover();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void discover();},60000);return()=>{indexAbort.current?.abort();window.clearInterval(timer);};},[]);
 // My Offers replays the entire discovered catalog; marketplace reads stay paged. Failed reads retain history.
 useEffect(()=>{if(creating||selectedId)return;let active=true,polling=false;const verify=async()=>{if(polling||document.visibilityState!=='visible')return;polling=true;let cursor=0;
 try{await Promise.all([0,1].map(async slot=>{for(;;){const c=visibleKnown[cursor++];if(!active||!c)return;
 const previous=listingsRef.current[c.genesis];if(previous&&!previous.error&&Date.now()-previous.at<(previous.snapshot?.provisional?15000:120000)){continue;}
 try{const value=await verifyMarketplace(c,slot);if(active)setListings(old=>({...old,[c.genesis]:{snapshot:{...value.snapshot,instance:{...value.snapshot.instance,state:Buffer.from(value.snapshot.instance.state)}},at:Date.now()}}));}
 catch(e){if(active)setListings(old=>({...old,[c.genesis]:{...old[c.genesis],error:String(e),at:old[c.genesis]?.at??0}}));}

 }}));}finally{polling=false;}};void verify();const timer=window.setInterval(()=>void verify(),15000);return()=>{active=false;cancelMarketplaceReads();window.clearInterval(timer);};},[creating,myOffers,selectedId,visibleKnown.map(c=>c.genesis).join(','),ops.filter(o=>o.kind==='create').map(o=>o.txid+':'+o.stage+':'+o.confirmations).join(',')]);
 useEffect(()=>{if(!selectedId){requestedVault.current=undefined;return;}if(busy||requestedVault.current===selectedId)return;const c=known.find(c=>c.genesis===selectedId);if(!c)return;requestedVault.current=selectedId;if(snapshot?.config.genesis!==selectedId)setVerified(undefined);void run(()=>refresh(c));},[selectedId,!!known.find(c=>c.genesis===selectedId),busy]);
 // Recheck an open visible vault at most every two minutes; actions always verify independently.
 useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible'&&selectedId&&!running.current&&Date.now()-updated>=120000){const c=known.find(c=>c.genesis===selectedId);if(c)void run(()=>refresh(c));}};document.addEventListener('visibilitychange',visible);const timer=window.setInterval(visible,120000);return()=>{document.removeEventListener('visibilitychange',visible);window.clearInterval(timer);};},[selectedId,updated,known.map(c=>c.genesis).join(',')]);
 async function loadOperations(){const list:Operation[]=await v3Call({operation:'list'});setOps(list);for(const op of list)if(op.kind==='create'&&op.config&&op.raw)save(op.config);setConfigs(saved());setClaims(await v3Call({operation:'claims'}));}
 // Serial bounded retry bursts, followed by capped passive checks for confirmation/reorgs.
 // No wallet connection is required, and these checks never rebroadcast.
 useEffect(()=>{let active=true,timer:number|undefined,attempt=0;
 const poll=async()=>{
  if(!active)return;
  try{if(!busy&&!running.current){
   const list:Operation[]=await v3Call({operation:'list'});
   // Reconcile the selected queue and its journal from the same independent replay.
   const selected=list.find(op=>op.raw&&op.config?.genesis===selectedId)?.config;
   if(selected&&active)try{await refresh(selected);}catch{/* Retain rows through provider failure. */}
   const background=list.filter(op=>(op.kind==='create'||op.registrationMode==='atomic')&&op.raw&&!(selected&&op.registrationMode==='atomic'&&op.config?.genesis===selectedId));
   const start=background.length?(attempt*4)%background.length:0;
   for(const op of [...background.slice(start),...background.slice(0,start)].slice(0,4))if(active){
    try{const preview=await v3Call({operation:'inspectRead',id:op.id});if(active&&!running.current)await v3Call({operation:'applyInspection',...preview});}catch{/* One unavailable operation must not prevent other recovery checks. */}
   }
   if(active)await loadOperations();
  }}catch{/* A failed refresh retains provisional rows and retries with backoff. */}
  finally{if(active)timer=window.setTimeout(()=>void poll(),OFFER_RETRY_DELAYS[Math.min(++attempt,OFFER_RETRY_DELAYS.length-1)]);}
 };
 timer=window.setTimeout(()=>void poll(),1000);
 return()=>{active=false;window.clearTimeout(timer);};},[busy,selectedId]);
 useEffect(()=>{const progress=(event:Event)=>{if(running.current)setMessage(String((event as CustomEvent).detail));};window.addEventListener('arena-wallet-progress',progress);return()=>window.removeEventListener('arena-wallet-progress',progress);},[]);
 async function run(work:()=>Promise<any>){if(running.current)return;running.current=true;setBusy(true);setMessage('Preparing vault…');try{const result=await work();if(result?.kind==='create'&&result.config&&result.raw){save(result.config);setConfigs(saved());}setMessage(typeof result==='string'?result:result?.status?`${result.status}: ${result.id}. ${result.status==='confirmed'?'Canonical confirmation verified.':result.status==='conflicted'?'A competing confirmed state superseded this claim.':'Broadcast acceptance is pending until canonical confirmation.'}`:result?.stage?`${result.stage==='pending'&&result.kind==='create'?'Vault pending (0-conf)':result.step+': '+result.stage}. ${result.txid??''}`:'');await loadOperations();}catch(e){setMessage(String(e));await loadOperations().catch(()=>{});}finally{running.current=false;setBusy(false);}}
 async function refresh(c:Config){let value;try{value=await v3Call({operation:'sync',config:c});}catch(e){setUpdated(0);setListings(old=>({...old,[c.genesis]:{...old[c.genesis],error:String(e),at:old[c.genesis]?.at??0}}));throw e;}for(const inspection of value.inspections??[])await v3Call({operation:'applyInspection',...inspection});if(value.inspections?.length)await loadOperations();value.snapshot.instance.state=Buffer.from(value.snapshot.instance.state);for(const a of value.snapshot.allocations)a.terms=Buffer.from(a.terms);setVerified({...value,observedAt:Date.now()});setListings(old=>({...old,[c.genesis]:{snapshot:value.snapshot,at:Date.now()}}));setUpdated(Date.now());setNow(Date.now());save(c);setConfigs(saved());return value;}
 const execute=(intent:Record<string,unknown>)=>{if(!wallet?.v3)throw Error('Connect a wallet declaring the selected network');return wallet.v3(intent);};
 // The wallet worker verifies offers during preparation, approval and broadcast.
 // Claims also compare the freshly displayed winning offer before wallet review.
 async function transact(key:string,intent:Record<string,unknown>){
  setActionMessage({key,text:'Verifying current blockchain state…'});
  try{if(intent.operation!=='offer'){const fresh=await refresh(intent.config as Config),current:Snapshot=fresh.snapshot;
   if(current.pending.length)throw Error('A competing vault transaction is pending. Reconcile it before acting.');
   if(intent.operation==='offer'){
    if(current.instance.state[5]!>=16)throw Error('Vault offer capacity exhausted (sixteen lifetime registrations).');
    validateNewOffer(current.config,intent.terms as typeof terms,rewardRemaining(current.instance.state));
   }
   if(intent.operation==='claim'){
    if(fresh.next.phase!=='ready')throw Error('Claim unavailable: '+fresh.next.reason);
    if(snapshot&&!Buffer.from(snapshot.instance.state).equals(current.instance.state))throw Error('Vault state changed. Review the updated winning offer and reward, then click again to request a new wallet approval.');
   }
   }
   const result=await execute(intent);
   // Publish returned signed journal evidence before waiting for any provider refresh.
   if(result?.kind==='offer'){setOps(old=>[result,...old.filter(o=>o.id!==result.id)]);setActionMessage({key,txid:result.txid,text:offerDisplayStatus(result)+`. Transaction ${result.txid??'not signed'}.`});}
   else setActionMessage(undefined);
   return result;}

  catch(e){setActionMessage({key,text:String(e)});throw e;}
 }

 const stakingAsset:Asset=stakeKind==='bch'?{kind:'bch'}:{kind:'token',category:stakeCategory},rewardAsset:Asset=rewardKind==='bch'?{kind:'bch'}:{kind:'token',category:rewardCategory};
 let creation:Parameters|undefined,creationError='';try{const cap=assetInputUnits(rewardAsset,release);if(cap===null)throw Error('Enter a valid release amount');creation=validateParameters({version:3,registryVersion:4,stakingAsset,rewardAsset,epoch:Date.parse(epoch+'Z')/1000,periodSeconds:Number(interval),periods:Number(count),cap});}catch(e){creationError=String(e);}
 const terms={stake:snapshot?assetInputUnits(snapshot.config.stakingAsset,s)??0n:0n,duration:Number(t),reward:snapshot?assetInputUnits(snapshot.config.rewardAsset,r)??0n:0n,maxWins:1};
 let termError='';try{if(snapshot)validateNewOffer(snapshot.config,terms,rewardRemaining(snapshot.instance.state));}catch(e){termError=String(e);}
 const scope=encode({route,stakeKind,rewardKind,stakeCategory,rewardCategory,release,interval,count,epoch,s,t,r});
 const scopeRef=useRef({scope,revision:0});
 if(scopeRef.current.scope!==scope)scopeRef.current={scope,revision:scopeRef.current.revision+1};
 async function request(intent:Record<string,unknown>){
  // Connected clicks retain the ordinary path. Only an offline click waits.
  const stateAction=intent.operation==='offer'||intent.operation==='claim',actionKey=intent.operation==='claim'?'claim':'offer';
  if(!walletRef.current?.pairing || walletRef.current.pairing().live)return stateAction?transact(actionKey,intent):execute(intent);
  const revision=scopeRef.current.revision,previous=snapshot&&offerRequestState(snapshot);
  try{
  const {wallet:live,check}=await restoreWalletRequest(()=>walletRef.current,()=>scopeRef.current.revision===revision,requestLifetime.current.signal,()=>{
   setMessage('Open Cashonize to continue. Waiting for a live wallet connection (up to 90 seconds)…');
   if(stateAction)setActionMessage({key:actionKey,text:'Open Cashonize to continue. Waiting for a live wallet connection (up to 90 seconds)…'});
  });
   check();setMessage('Cashonize connected. Verifying current blockchain state and inputs…');
   if(stateAction){
    const fresh=await refresh(intent.config as Config);check();
    if(previous!==offerRequestState(fresh.snapshot))throw Error('Vault state changed while waiting. Review the updated vault and continue again.');
    if(fresh.snapshot.pending.length)throw Error('A competing vault transaction is pending. Review and continue again.');
    if(intent.operation==='offer')validateNewOffer(fresh.snapshot.config,intent.terms as typeof terms,rewardRemaining(fresh.snapshot.instance.state));
    else if(fresh.next.phase!=='ready')throw Error('Claim unavailable: '+fresh.next.reason);
   }
   check();
   const result=await live.v3!(intent,check);
   if(result?.kind==='offer'){setOps(old=>[result,...old.filter(o=>o.id!==result.id)]);setActionMessage({key:'offer',txid:result.txid,text:offerDisplayStatus(result)+`. Transaction ${result.txid??'not signed'}.`});}
   else setActionMessage(undefined);
   return result;
  }catch(e){if(stateAction)setActionMessage({key:actionKey,text:String(e)});throw e;}
 }
 async function manageOffer(c:Config,slot:number,allocation?:string){
  const expected=selectedOwner;if(!expected)throw Error('Open Cashonize and connect the owner wallet.');
  let live=walletRef.current;
  if(!live?.v3||live.v3Availability?.().available===false||live.pairing?.().live===false){
   setMessage('Open Cashonize and reconnect the owner wallet for authorization.');
   if(!live?.pairing?.().paired)throw Error('Open Cashonize and reconnect the owner wallet using Connect Wallet for authorization.');
   const restored=await restoreWalletRequest(()=>walletRef.current,()=>selectedOwnerRef.current===expected,requestLifetime.current.signal,()=>setMessage('Open Cashonize and reconnect the owner wallet for authorization. Waiting up to 90 seconds…'));
   live=restored.wallet;
  }
  if(live.publicKey()!==expected)throw Error('The connected wallet does not own this offer. Review My Offers for the connected wallet.');
  const fresh=await refresh(c),current:Snapshot=fresh.snapshot,row=ownedOffers(current,expected).find(o=>o.record.slot===slot);
  if(!row)throw Error('Offer is not owned by the selected wallet.');
  const intent=offerActionIntent(current,expected,slot,allocation),action='action' in intent?intent.action:undefined;
  if(!allocation&&!window.confirm(row.recovery?'Recover the unused staking commitment? Each necessary transaction requires explicit wallet approval and BCH fees.':'Cancel this active offer? This removes it from the queue and recovers its unused stake. Cancellation and recovery use separate transactions, each requiring wallet approval and BCH fees. Continue until recovery is confirmed.'))return;
  const journal:Operation[]=await v3Call({operation:'list'});
  const existing=journal.find(o=>o.config?.genesis===c.genesis&&o.owner.publicKey===expected&&o.step!=='complete'&&(allocation?o.kind==='withdraw'&&o.allocation===allocation:o.kind==='action'&&o.slot===slot&&o.action===action));
  const result=existing?await live.v3!({operation:'resume',id:existing.id}):await live.v3!(intent);
  await refresh(c);
  setMessage('Transaction journal saved. Continue in Transaction recovery for any remaining wallet approval. Cancellation is complete only after unused stake recovery confirms; withdrawal is complete only after confirmation.');
  return result;
 }
 const queue=snapshot?rankings(snapshot.instance.state,false):[],next=shown?.next;
 const offerReason=stateReason||(!canRequest?walletReason:'')||termError||(snapshot&&snapshot.instance.state[5]!>=16?'vault offer capacity exhausted (sixteen lifetime registrations)':'');
 const claimReason=stateReason||(!canRequest?walletReason:'')||(!stale&&next?.phase!=='ready'?next?.reason||'no eligible reward claim':'');
 return <div className="v3-arena" style={{overflowWrap:'anywhere'}}>
 {networkStatus.startsWith('Provider verification unavailable')&&<p className="provider-status" role="status">Provider verification unavailable. Please retry shortly.</p>}
 <nav className="v3-tabs" aria-label="V3 actions"><a className="create-vault-tab" href="#/v3" aria-current={creating?'page':undefined}>Create Vault</a><a href="#/v3/offers" aria-current={!creating&&!myOffers?'page':undefined}>Browse All Vaults</a></nav>
 {myOffers&&<p>{known.length} known vaults · {Object.values(listings).filter(l=>l.snapshot).length} retained verified snapshots. {discovering?'Discovering more vaults…':''} <button disabled={discovering||busy} onClick={()=>{myOfferPages.current.clear();void discover();}}>Refresh public discovery</button>{discoveryError}</p>}
 {myOffers&&<MyOffers owner={selectedOwner} live={walletReady} listings={listings} operations={ops} busy={busy} act={(c,slot,allocation)=>void run(()=>manageOffer(c,slot,allocation))}/>}
 <div hidden={!creating}> <section className="panel"><div className="form-grid"><label>Staking asset<select value={stakeKind} onChange={e=>setStakeKind(e.target.value)}><option value="bch">BCH</option><option value="token">Fungible CashToken</option></select></label>{stakeKind==='token'&&<label>Staking category<input value={stakeCategory} onChange={e=>setStakeCategory(e.target.value)}/></label>}<label>Reward asset<select value={rewardKind} onChange={e=>{setRewardKind(e.target.value);setRelease(e.target.value==='bch'?'0.00002000':'1000');}}><option value="bch">BCH</option><option value="token">Fungible CashToken</option></select></label>{rewardKind==='token'&&<label>Reward category<input value={rewardCategory} onChange={e=>setRewardCategory(e.target.value)}/></label>}<label>Reward released each interval<input value={release} onChange={e=>setRelease(e.target.value)}/></label><label>Interval (seconds)<input value={interval} onChange={e=>setInterval(e.target.value)}/></label><label>Number of releases (1–1000)<input type="number" min="1" max="1000" step="1" value={count} onChange={e=>setCount(e.target.value)}/></label><label>Schedule starts (UTC)<input type="datetime-local" step="1" value={epoch} onChange={e=>setEpoch(e.target.value)}/></label></div>{creationError?<p role="alert">{creationError}</p>:creation&&<><p>Vault duration: {creation.periods*creation.periodSeconds} seconds ({(creation.periods*creation.periodSeconds/86400).toFixed(2)} days). Estimated end date: {new Date((creation.epoch+creation.periods*creation.periodSeconds)*1000).toISOString()}. Reward availability depends on blockchain Median Time Past (MTP).</p><p>Deposit the entire reserve upfront: {assetAmount(creation.rewardAsset,creation.cap*BigInt(creation.periods))}. Parameters are immutable. Exact fees and change appear before approval.</p></>}<button disabled={busy||!creation||!canRequest} onClick={()=>void run(()=>request({operation:'create',parameters:creation}))}>{busy?'Preparing vault…':'Create Vault'}</button><p role="status" aria-live="polite">{message}</p>{funding&&<p aria-live="polite">Found {funding.total} BCH satoshis on {funding.addressesQueried} addresses; {funding.available} candidate satoshis after restrictions; {funding.reserved} reserved. {funding.unsignedReleased} released from unsigned or refused plans; their journals are preserved. {funding.confirmed} confirmed, {funding.unconfirmed} unconfirmed, {funding.unclassified} not classified. {funding.selectedInputs} selected inputs from {funding.availableInputs} eligible candidates. {funding.verification==='selected-inputs-verified'?'Selected inputs verified on both providers.':'Inputs still require verification before signing.'}</p>}</section>
 </div>
 {!creating&&!myOffers&&!selectedId&&<section className="v3-known"><h2>Known vaults</h2><button disabled={discovering} onClick={()=>void discover()}>Refresh public discovery</button>
 {discoveryError&&<p role="status">{discoveryError}</p>}
 {!known.length&&<p>{indexReady?'No known vaults yet.':'Loading vaults…'}</p>}
 <table className="marketplace-table"><caption className="sr-only">Vault marketplace. Numbers indicate list positions, not on-chain identifiers.</caption><thead><tr>{['Vault','Total max reward','Staking asset','Offers'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
 {visibleKnown.map((c,i)=>{const listing=listings[c.genesis],view=listing?.snapshot,current=view&&!listing.error&&now-listing.at<=120000,number=page*20+i+1;return <tr key={c.genesis}>
 <td data-label="Vault"><a className="marketplace-link" href={`#/v3/vault/${c.genesis}`} aria-label={`Vault ${number}`}>{number}</a></td>
 <td data-label="Total max reward" title="Maximum scheduled rewards across all releases; public vault parameters.">{marketReward(c.rewardAsset,c.cap*BigInt(c.periods))}</td>
 <td data-label="Staking asset">{marketAsset(c.stakingAsset)}</td>
 <td data-label="Offers" title={listing?.error?'Current blockchain verification unavailable. Open vault to retry.':listing?'Last independently verified '+new Date(listing.at).toISOString():undefined}>{current?<>{rankings(view.instance.state,false).length}{view.provisional&&<small>0-conf · provisional</small>}</>:<>{listing?.error?'Unavailable':'Verifying…'}</>}</td>
 </tr>;})}</tbody></table>
 <nav className="marketplace-pagination" aria-label="Vault pages"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous vaults</button><span>Page {page+1}</span><button disabled={(page+1)*20>=known.length} onClick={()=>setPage(p=>p+1)}>Next vaults</button>{discoveryCursor&&<button disabled={discovering} onClick={()=>void discover(discoveryCursor)}>Load more public vaults</button>}</nav></section>}

 {selectedId&&<><a className="back-link" href="#/v3/offers">← Known vaults</a><h2>Vault {selectedId.slice(0,16)}</h2>{!snapshot&&<p>{known.some(c=>c.genesis===selectedId)?'Verification temporarily unavailable — verifying vault genesis and current state. Configuration retained.':'Configuration not found. Return to Known vaults and refresh public discovery.'}</p>}</>}
 {selectedId&&!snapshot&&known.filter(c=>c.genesis===selectedId).map(c=><section className="panel" key={c.genesis}><h3>Retained vault configuration</h3><p>{c.registryVersion===4?'Atomic V4':'V3'} · Staking: {assetLabel(c.stakingAsset)} · Rewards: {assetLabel(c.rewardAsset)} · Maximum reward: {assetAmount(c.rewardAsset,c.cap)} every {c.periodSeconds}s.</p><p>Verification temporarily unavailable. Financial actions are disabled until current verification succeeds.</p><button disabled>Make an Offer</button>{listings[c.genesis]?.snapshot&&<p>Stale, non-authoritative snapshot: remaining reserve {assetAmount(c.rewardAsset,rewardRemaining(listings[c.genesis]!.snapshot!.instance.state))}; active offers {rankings(listings[c.genesis]!.snapshot!.instance.state,false).length}.</p>}<button disabled={busy} onClick={()=>void run(()=>refresh(c))}>Retry vault verification</button></section>)}
 {!creating&&selectedId&&<SubmittedOffers operations={ops} genesis={selectedId} snapshot={updated?snapshot:undefined}/>}
 {!creating&&selectedId&&snapshot&&snapshot.config.genesis===selectedId&&<section className="v3-detail"><div className="panel v3-summary"><h2>Vault summary</h2><button disabled={busy} onClick={()=>void run(()=>refresh(snapshot.config))}>Refresh vault state</button>
 <table className="vault-summary-table"><caption className="sr-only">Vault summary</caption><tbody>
 <tr><th scope="row">Staking asset</th><td>{assetLabel(snapshot.config.stakingAsset)}</td></tr>
 <tr><th scope="row">Reward asset</th><td>{assetLabel(snapshot.config.rewardAsset)}</td></tr>
 <tr><th scope="row">Total reward reserve</th><td>{assetAmount(snapshot.config.rewardAsset,snapshot.config.cap*BigInt(snapshot.config.periods))}</td></tr>
 <tr><th scope="row">Remaining reward reserve</th><td>{assetAmount(snapshot.config.rewardAsset,rewardRemaining(snapshot.instance.state))}</td></tr>
 <tr><th scope="row">Rewards available in the pot</th><td>{assetAmount(snapshot.config.rewardAsset,next.available)}</td></tr>
 <tr><th scope="row">Release amount</th><td>{assetAmount(snapshot.config.rewardAsset,snapshot.config.cap)}</td></tr>
 <tr><th scope="row">Release frequency</th><td>Every {snapshot.config.periodSeconds} seconds</td></tr>
 <tr><th scope="row">Next scheduled release</th><td>{releaseCount(snapshot.config,snapshot.clock.mtp-1)>=snapshot.config.periods?'All rewards released':new Date((snapshot.config.epoch+(releaseCount(snapshot.config,snapshot.clock.mtp-1)+1)*snapshot.config.periodSeconds)*1000).toISOString()}</td></tr>
 </tbody></table>
 {!independentlyVerified&&<p role="status">Single-provider / retained display only — independent state verification incomplete. Financial actions disabled.</p>}
 {snapshot.provisional&&<p>Pending (0-conf) state verified; provisional until confirmed.</p>}
 {!!snapshot.pending.length&&<p>Pending state spends disable actions.</p>}
 </div><div className="panel v3-queue"><h2>Live ranked queue</h2>{!independentlyVerified&&<p role="status">State verification incomplete — provisional read-only queue. Observed {new Date(shown?.observedAt??now).toISOString()}. {message.includes('Conflicting')?'Providers disagree; no state is authoritative.':''}</p>}<p>Higher P ranks first. Exact ties go to earliest registration.</p><div className="table-scroll"><table aria-label="Live ranked queue"><thead><tr>{['Rank','Stake S','Duration T (seconds)','Requested reward R','Priority P = S × T / R','Offer status'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{queue.map((o,i)=><tr key={o.slot}><td>{i+1}</td><td>{assetAmount(snapshot.config.stakingAsset,BigInt(o.stake))}</td><td>{o.duration}</td><td>{assetAmount(snapshot.config.rewardAsset,BigInt(o.reward))}</td><td>{BigInt(o.stake)*BigInt(o.duration)} / {o.reward}</td><td>{snapshot.provisional?'Pending (0-conf) · provisional':!independentlyVerified?'Provisional':'Active'} · #{o.slot}{o.maxWins>1?` · Legacy offer: ${o.maxWins-o.wins} reward payment${o.maxWins-o.wins===1?'':'s'} remaining`:''}</td></tr>)}</tbody></table></div>{!queue.length&&<p>{pendingOperation?.kind==='offer'&&pendingOperation.raw?'No independently verified active offers yet. Submitted offers above are awaiting verification.':'No active offers. Make the first offer; released rewards continue accumulating.'}</p>}</div><div className="v3-actions"><div className="panel v3-offer"><h3>Make an Offer</h3><p>Effective locks round up to 512-second units in consensus MTP; elapsed wall time can vary. Priority uses the requested T.</p><p className="priority-formula">P(Priority) = S x T / R</p><div className="form-grid" role="group" aria-label="New v3 offer"><label>Stake S ({snapshot.config.stakingAsset.kind==='bch'?'BCH':'raw units'})<input value={s} onChange={e=>setS(e.target.value)}/></label><label>Duration T (seconds)<input value={t} onChange={e=>setT(e.target.value)}/></label><label>Requested reward R ({snapshot.config.rewardAsset.kind==='bch'?'BCH':'raw units'})<input value={r} onChange={e=>setR(e.target.value)}/></label></div>{termError?<p role="alert">{termError}</p>:<p>Required staking commitment: {assetAmount(snapshot.config.stakingAsset,terms.stake)}. Exact priority: {exactPriority(terms).numerator.toString()} / {terms.reward.toString()}. Estimated queue position: {1+queue.filter(o=>BigInt(o.stake)*BigInt(o.duration)*terms.reward>=terms.stake*BigInt(terms.duration)*BigInt(o.reward)).length}. Independent lock: {(allocationSequence(terms.duration)&65535)*512}s in consensus MTP.</p>}<button className="v3-primary" disabled={!!offerReason} onClick={()=>void run(()=>request({operation:'offer',config:snapshot.config,terms}))}>Make an Offer</button>{offerReason&&<p>Make an Offer unavailable: {offerReason}.</p>}{feedback('offer')}{busy&&<p aria-live="polite">{message}</p>}
</div><div className="panel v3-claim" aria-label="Claim reward"><p>Winning reward: {queue[0]?assetAmount(snapshot.config.rewardAsset,BigInt(queue[0].reward)):'none'}.</p><p>Caller pays the fee. The reward goes to the winning offer.</p><button disabled={!!claimReason} title={claimReason?claimReason.replace(/\bbuffer\b/gi,'pot'):undefined} onClick={()=>void run(()=>request({operation:'claim',config:snapshot.config}))}>Claim reward</button>{feedback('claim')}</div></div>
 <div className="v3-recovery offers-scroll" role="region" aria-label="My Offers list"><MyOffers compact owner={selectedOwner} live={walletReady} listings={{[snapshot.config.genesis]:{snapshot,at:updated||shown?.observedAt||now,error:independentlyVerified?undefined:'Independent verification incomplete'}}} operations={ops} busy={busy} act={(c,slot,allocation)=>void run(()=>manageOffer(c,slot,allocation))}/></div></section>}
 <details className="panel"><summary>Transaction recovery</summary>{Object.values(listings).flatMap(l=>l.snapshot?ownedOffers(l.snapshot,selectedOwner).filter(o=>o.recovery).map(o=><p key={l.snapshot!.config.genesis+o.record.slot}>Recovery pending · Vault {l.snapshot!.config.genesis.slice(0,12)} · Offer {o.record.slot+1}. Unused stake has not been returned. <button disabled={busy} onClick={()=>void run(()=>manageOffer(l.snapshot!.config,o.record.slot))}>Continue cancellation with wallet approval</button></p>):[])}<label><input type="checkbox" checked={showPending} onChange={e=>setShowPending(e.target.checked)}/>Display pending / unconfirmed (0-conf) operations</label><p>Vault creation and claims use one wallet approval. Direct genesis is one transaction; the covenant-controlled path broadcasts a signed parent and a permissionless child without a second signature. Pending state and allocations remain provisional until confirmed. Saved transactions remain recoverable after refresh.</p>{ops.filter(o=>showPending||o.stage==='confirmed').map(o=><article key={o.id}><p>{o.kind}: {o.kind==='offer'?offerDisplayStatus(o):o.step+' / '+o.stage} · {o.txid} {o.error}</p>{o.kind==='action'&&o.action===1&&o.owner?.publicKey===selectedOwner&&!records(listings[o.config?.genesis??'']?.snapshot?.instance.state??Buffer.alloc(794),false).find(r=>r.slot===o.slot)?.refunded&&<p>Cancellation workflow: unused stake recovery must be confirmed on-chain. <button disabled={busy} onClick={()=>void run(()=>manageOffer(o.config!,o.slot!))}>Continue cancellation</button></p>}{o.plan&&<p>Wallet review: {o.plan.label}. Fee: {o.plan.fee} BCH satoshis. Total BCH inputs: {o.plan.request.sourceOutputs.reduce((n,s)=>n+s.valueSatoshis,0n).toString()} satoshis. Token inputs: {o.plan.request.sourceOutputs.filter(s=>s.token).map(s=>`${s.token!.amount} raw units of ${Buffer.from(s.token!.category).toString('hex')}`).join('; ')||'none'}.</p>}{(o.raw||o.funding)&&<button disabled={busy} onClick={()=>void run(()=>v3Call({operation:'inspect',id:o.id}))}>Reconcile transaction status</button>}{!o.raw&&o.step!=='complete'&&<button disabled={busy} onClick={()=>void run(()=>request({operation:'resume',id:o.id}))}>Continue with explicit wallet approval</button>}{o.funding&&<p>Funding transaction: <code>{o.funding}</code>. Signed funding remains recoverable.</p>}{canDiscardUnsigned(o)&&<button disabled={busy} onClick={()=>void run(()=>v3Call({operation:'discard',id:o.id}))}>Discard unsigned operation</button>}{o.raw&&o.step!=='complete'&&<button disabled={busy} onClick={()=>void run(()=>v3Call({operation:'rebroadcast',id:o.id}))}>Retry identical transaction</button>}{o.fundingRaw&&o.step!=='complete'&&<button disabled={busy} onClick={()=>void run(()=>v3Call({operation:'rebroadcastFunding',id:o.id}))}>Retry identical funding</button>}<details><summary>Public recovery configuration</summary><pre>{encode(o.config??o.parameters)}</pre></details></article>)}{claims.filter(c=>showPending||c.status==='confirmed').map(c=><p key={c.id}>Claim {c.id}: {c.status} {c.error}<button disabled={busy} onClick={()=>void run(()=>v3Call({operation:'reconcileClaim',config:c.config,id:c.id}))}>Verify claim status</button></p>)}</details><p role={creating?undefined:"status"}>{creating?'':message}</p></div>;
}
