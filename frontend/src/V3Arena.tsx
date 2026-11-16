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
 const selectedId=route.match(/^#\/v3\/vault\/([a-f0-9]{64})$/i)?.[1]?.toLowerCase(),creating=route==='#/v3';

 useLayoutEffect(()=>{if(indexReady||creating||selectedId)document.getElementById('arena-public-preview')?.remove();},[indexReady,creating,selectedId]);
 const wallet=useWalletTransactions(),[configs,setConfigs]=useState(saved),[verified,setVerified]=useState<any>(),[updated,setUpdated]=useState(0),[now,setNow]=useState(Date.now()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ops,setOps]=useState<Operation[]>([]),[claims,setClaims]=useState<ClaimRecord[]>([]),[showPending,setShowPending]=useState(true);
 const known=[...new Map([...configs,...catalog].map(c=>[c.genesis,c])).values()],visibleKnown=known.slice(page*20,(page+1)*20);
 const [stakeKind,setStakeKind]=useState('bch'),[rewardKind,setRewardKind]=useState('bch'),[stakeCategory,setStakeCategory]=useState(''),[rewardCategory,setRewardCategory]=useState(''),[release,setRelease]=useState('0.00002000'),[interval,setInterval]=useState('3600'),[count,setCount]=useState('10'),[epoch,setEpoch]=useState(new Date(Date.now()+3600000).toISOString().slice(0,19));
 const [funding,setFunding]=useState<FundingReport>();
 useEffect(()=>{setFunding(undefined);},[wallet]);
 useEffect(()=>{const report=(event:Event)=>setFunding((event as CustomEvent).detail);window.addEventListener('arena-funding-report',report);return()=>window.removeEventListener('arena-funding-report',report);},[]);
 const [s,setS]=useState('0.00003000'),[t,setT]=useState('3600'),[r,setR]=useState('0.00001000');
 const [networkStatus,setNetworkStatus]=useState('Verifying '+v3Chain+' providers…');
 const walletAvailability=wallet?.v3Availability?.(),walletReady=!!wallet?.v3&&(walletAvailability?.available??true);
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
 let owner='';try{if(walletReady)owner=wallet!.publicKey();}catch{/* Live wallet checks also run before signing. */}
 const pendingOperation=ops.find(o=>o.config?.genesis===snapshot?.config.genesis&&o.step!=='complete'&&!(o.raw&&o.step==='action'&&[...(snapshot?.history??[]),...(snapshot?.pendingHistory??[])].includes(o.txid??'')));
 const commonReason=busy?'operation in progress':!independentlyVerified?'Independent verification incomplete':!walletReady?'connect a compatible WizardConnect/Cashonize wallet on the selected network. '+(walletAvailability?.reason??''):snapshot?.pending.length?'competing vault transaction pending':pendingOperation?(pendingOperation.raw||pendingOperation.fundingRaw?'Awaiting automatic verification of the signed '+pendingOperation.kind+' transaction. Signed evidence is retained in Transaction recovery.':'An unsigned '+pendingOperation.kind+' operation awaits wallet approval or unsigned cancellation in Transaction recovery'):'';
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
 useEffect(()=>{void discover();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void discover();},60000);return()=>{indexAbort.current?.abort();window.clearInterval(timer);};},[]);
 // Only the visible page is replayed. Failed reads retain the previous display snapshot.
 useEffect(()=>{if(creating||selectedId)return;let active=true,polling=false;const verify=async()=>{if(polling||document.visibilityState!=='visible')return;polling=true;let cursor=0;
 try{await Promise.all([0,1].map(async slot=>{for(;;){const c=visibleKnown[cursor++];if(!active||!c)return;
 const previous=listingsRef.current[c.genesis];if(previous&&!previous.error&&Date.now()-previous.at<(previous.snapshot?.provisional?15000:120000)){continue;}
 try{const value=await verifyMarketplace(c,slot);if(active)setListings(old=>({...old,[c.genesis]:{snapshot:{...value.snapshot,instance:{...value.snapshot.instance,state:Buffer.from(value.snapshot.instance.state)}},at:Date.now()}}));}
 catch(e){if(active)setListings(old=>({...old,[c.genesis]:{...old[c.genesis],error:String(e),at:old[c.genesis]?.at??0}}));}

 }}));}finally{polling=false;}};void verify();const timer=window.setInterval(()=>void verify(),15000);return()=>{active=false;cancelMarketplaceReads();window.clearInterval(timer);};},[creating,selectedId,visibleKnown.map(c=>c.genesis).join(','),ops.filter(o=>o.kind==='create').map(o=>o.txid+':'+o.stage+':'+o.confirmations).join(',')]);
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
 async function run(work:()=>Promise<any>){if(running.current)return;running.current=true;setBusy(true);setMessage('Preparing vault…');try{const result=await work();if(result?.kind==='create'&&result.config&&result.raw){save(result.config);setConfigs(saved());}setMessage(typeof result==='string'?result:result?.status?`${result.status}: ${result.id}. ${result.status==='confirmed'?'Canonical confirmation verified.':result.status==='conflicted'?'A competing confirmed state superseded this claim.':'Broadcast acceptance is pending until canonical confirmation.'}`:result?.stage?`${result.stage==='pending'&&result.kind==='create'?'Vault pending (0-conf)':result.step+': '+result.stage}. ${result.txid??''}`:'Verified');await loadOperations();}catch(e){setMessage(String(e));await loadOperations().catch(()=>{});}finally{running.current=false;setBusy(false);}}
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
 const queue=snapshot?rankings(snapshot.instance.state,false):[],next=shown?.next;
 const offerReason=commonReason||termError||(snapshot&&snapshot.instance.state[5]!>=16?'vault offer capacity exhausted (sixteen lifetime registrations)':'');
 const claimReason=commonReason||(!stale&&next?.phase!=='ready'?next?.reason||'no eligible reward claim':'');
 return <div className="v3-arena" style={{overflowWrap:'anywhere'}}>
 {networkStatus.startsWith('Provider verification unavailable')&&<p className="provider-status" role="status">Provider verification unavailable. Please retry shortly.</p>}
 <nav className="v3-tabs" aria-label="V3 actions"><a href="#/v3/offers" aria-current={!creating?'page':undefined}>Make an Offer</a><a href="#/v3" aria-current={creating?'page':undefined}>Create a Vault</a></nav>
 <div hidden={!creating}> <section className="panel"><div className="form-grid"><label>Staking asset<select value={stakeKind} onChange={e=>setStakeKind(e.target.value)}><option value="bch">BCH</option><option value="token">Fungible CashToken</option></select></label>{stakeKind==='token'&&<label>Staking category<input value={stakeCategory} onChange={e=>setStakeCategory(e.target.value)}/></label>}<label>Reward asset<select value={rewardKind} onChange={e=>{setRewardKind(e.target.value);setRelease(e.target.value==='bch'?'0.00002000':'1000');}}><option value="bch">BCH</option><option value="token">Fungible CashToken</option></select></label>{rewardKind==='token'&&<label>Reward category<input value={rewardCategory} onChange={e=>setRewardCategory(e.target.value)}/></label>}<label>Reward released each interval<input value={release} onChange={e=>setRelease(e.target.value)}/></label><label>Interval (seconds)<input value={interval} onChange={e=>setInterval(e.target.value)}/></label><label>Number of releases (1–1000)<input type="number" min="1" max="1000" step="1" value={count} onChange={e=>setCount(e.target.value)}/></label><label>Schedule starts (UTC)<input type="datetime-local" step="1" value={epoch} onChange={e=>setEpoch(e.target.value)}/></label></div>{creationError?<p role="alert">{creationError}</p>:creation&&<><p>Vault duration: {creation.periods*creation.periodSeconds} seconds ({(creation.periods*creation.periodSeconds/86400).toFixed(2)} days). Estimated end date: {new Date((creation.epoch+creation.periods*creation.periodSeconds)*1000).toISOString()}. Reward availability depends on blockchain Median Time Past (MTP).</p><p>Deposit the entire reserve upfront: {assetAmount(creation.rewardAsset,creation.cap*BigInt(creation.periods))}. Parameters are immutable. Exact fees and change appear before approval.</p></>}<button disabled={busy||!creation||!walletReady} onClick={()=>void run(()=>execute({operation:'create',parameters:creation}))}>{busy?'Preparing vault…':'Create Vault'}</button><p role="status" aria-live="polite">{message}</p>{funding&&<p aria-live="polite">Found {funding.total} BCH satoshis on {funding.addressesQueried} addresses; {funding.available} candidate satoshis after restrictions; {funding.reserved} reserved. {funding.unsignedReleased} released from unsigned or refused plans; their journals are preserved. {funding.confirmed} confirmed, {funding.unconfirmed} unconfirmed, {funding.unclassified} not classified. {funding.selectedInputs} selected inputs from {funding.availableInputs} eligible candidates. {funding.verification==='selected-inputs-verified'?'Selected inputs verified on both providers.':'Inputs still require verification before signing.'}</p>}</section>
 </div>
 {!creating&&!selectedId&&<section className="v3-known"><h2>Known vaults</h2><button disabled={discovering} onClick={()=>void discover()}>Refresh public discovery</button>
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
 {!creating&&selectedId&&snapshot&&snapshot.config.genesis===selectedId&&<section className="v3-detail"><div className="panel v3-summary"><h2>Vault summary</h2><p>{snapshot.config.registryVersion===4?'RegistryAtomicV4 · direct atomic offer registration':'RegistryV3 · legacy offer registration'}</p><button disabled={busy} onClick={()=>void run(()=>refresh(snapshot.config))}>Refresh vault state</button><dl className="v3-figures"><div><dt>Staking asset</dt><dd>{assetLabel(snapshot.config.stakingAsset)}</dd></div><div><dt>Reward asset</dt><dd>{assetLabel(snapshot.config.rewardAsset)}</dd></div></dl><p>{!independentlyVerified?'Single-provider / retained display only — independent state verification incomplete. Financial actions disabled.':stale?'Displayed state may be outdated — actions verify current blockchain state automatically.':snapshot.provisional?'Pending (0-conf) state verified; provisional until confirmed.':'Confirmed state verified.'} Chain MTP {new Date(snapshot.clock.mtp*1000).toISOString()}. {snapshot.pending.length?'Pending state spends disable actions.':''}</p><p>Remaining reward reserve: {assetAmount(snapshot.config.rewardAsset,rewardRemaining(snapshot.instance.state))}. Available buffer: {assetAmount(snapshot.config.rewardAsset,next.available)}. Release amount: {assetAmount(snapshot.config.rewardAsset,snapshot.config.cap)} every {snapshot.config.periodSeconds}s.</p><p>Next scheduled release: {releaseCount(snapshot.config,snapshot.clock.mtp-1)>=snapshot.config.periods?'All rewards released':new Date((snapshot.config.epoch+(releaseCount(snapshot.config,snapshot.clock.mtp-1)+1)*snapshot.config.periodSeconds)*1000).toISOString()}. Rewards become usable after MTP exceeds the boundary.</p></div><div className="panel v3-queue"><h2>Live ranked queue</h2>{!independentlyVerified&&<p role="status">State verification incomplete — provisional read-only queue. Observed {new Date(shown?.observedAt??now).toISOString()}. {message.includes('Conflicting')?'Providers disagree; no state is authoritative.':''}</p>}<p>Higher P ranks first. Exact ties go to earliest registration.</p><div className="table-scroll"><table><thead><tr>{['Rank','Stake S','Duration T (seconds)','Requested reward R','Priority P = S × T / R','Offer status'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{queue.map((o,i)=><tr key={o.slot}><td>{i+1}</td><td>{assetAmount(snapshot.config.stakingAsset,BigInt(o.stake))}</td><td>{o.duration}</td><td>{assetAmount(snapshot.config.rewardAsset,BigInt(o.reward))}</td><td>{BigInt(o.stake)*BigInt(o.duration)} / {o.reward}</td><td>{snapshot.provisional?'Pending (0-conf) · provisional':!independentlyVerified?'Provisional':'Active'} · #{o.slot}{o.maxWins>1?` · Legacy offer: ${o.maxWins-o.wins} reward payment${o.maxWins-o.wins===1?'':'s'} remaining`:''}</td></tr>)}</tbody></table></div>{!queue.length&&<p>{pendingOperation?.kind==='offer'&&pendingOperation.raw?'No independently verified active offers yet. Submitted offers above are awaiting verification.':'No active offers. Make the first offer; released rewards continue accumulating.'}</p>}<p>Current state transaction: {snapshot.instance.inputs?.[0]?.txid??'Unavailable'} · {snapshot.provisional?'Pending (0-conf), not confirmed':'Confirmed'}</p><p>Top-ranked offer: {queue[0]?`#${queue[0].slot}`:'none'}. {next.phase==='blocked'?next.reason:''}</p></div><div className="panel v3-offer"><h3>Make an Offer</h3><p>Effective locks round up to 512-second units in consensus MTP; elapsed wall time can vary. Priority uses the requested T.</p><p>Lock S once for T to request one reward R. Offers are welcome even when the available buffer is zero.</p><div className="form-grid" role="group" aria-label="New v3 offer"><label>Stake S ({snapshot.config.stakingAsset.kind==='bch'?'BCH':'raw units'})<input value={s} onChange={e=>setS(e.target.value)}/></label><label>Duration T (seconds)<input value={t} onChange={e=>setT(e.target.value)}/></label><label>Requested reward R ({snapshot.config.rewardAsset.kind==='bch'?'BCH':'raw units'})<input value={r} onChange={e=>setR(e.target.value)}/></label></div>{termError?<p role="alert">{termError}</p>:<p>Required staking commitment: {assetAmount(snapshot.config.stakingAsset,terms.stake)}. Exact priority: {exactPriority(terms).numerator.toString()} / {terms.reward.toString()}. Estimated queue position: {1+queue.filter(o=>BigInt(o.stake)*BigInt(o.duration)*terms.reward>=terms.stake*BigInt(terms.duration)*BigInt(o.reward)).length}. Independent lock: {(allocationSequence(terms.duration)&65535)*512}s in consensus MTP.</p>}<p>{snapshot.config.registryVersion===4?'Atomic registration: one transaction, one Cashonize approval, one 10,000-satoshi miner fee.':'Legacy RegistryV3: two transactions and two Cashonize approvals, with 20,000 satoshis in miner fees.'} Token change may require a 1,000-satoshi carrier. Stake and carriers are separate from miner fees. Exact funding and change are shown before approval.</p><button className="v3-primary" disabled={!!offerReason} onClick={()=>void run(()=>transact('offer',{operation:'offer',config:snapshot.config,terms}))}>Make an Offer</button>{offerReason&&<p>Make an Offer unavailable: {offerReason}.</p>}{feedback('offer')}{busy&&<p aria-live="polite">{message}</p>}
</div><div className="panel v3-claim"><h3>Claim reward</h3><p>Winning reward: {queue[0]?assetAmount(snapshot.config.rewardAsset,BigInt(queue[0].reward)):'none'}. Caller pays {String(shown.required)} BCH satoshis: miner fee {String(shown.minerFee)} + CashToken carriers {String(shown.carriers)}. Carriers fund the winner's reward / locked allocation outputs; they are separate from the miner fee. Unused BCH returns to the paying wallet address. The caller receives no reward or reimbursement. One verified token-free BCH coin is required, with exact funding or at least 1,000 satoshis returned as change.</p><button disabled={!!claimReason} onClick={()=>void run(()=>transact('claim',{operation:'claim',config:snapshot.config}))}>Review and pay fee in wallet</button>{claimReason&&<p>Claim unavailable: {claimReason}.</p>}{feedback('claim')}

</div>
 <div className="panel v3-recovery"> <h3>Offer recovery</h3>{records(snapshot.instance.state,false).map(o=>{
 const cancelReason=commonReason||(o.owner!==owner?'only the offer owner can cancel':o.cancelled?'offer already cancelled':'');
 const recoverReason=commonReason||(o.owner!==owner?'only the offer owner can recover the commitment':!o.cancelled?'cancel the offer first':o.refunded?'commitment already recovered':o.wins===o.maxWins?'no unused commitment':'');
 return <div key={o.slot}><p>Offer #{o.slot}: {o.refunded?'recovered':o.cancelled?'cancelled':o.wins===o.maxWins?'completed':'active'}{o.maxWins>1?` · Legacy offer: ${o.wins}/${o.maxWins} payments received · remaining commitment ${assetAmount(snapshot.config.stakingAsset,(o.refunded?0n:BigInt(o.stake)*BigInt(o.maxWins-o.wins)))}`:''}</p><button disabled={!!cancelReason} onClick={()=>void run(()=>transact(`cancel-${o.slot}`,{operation:'action',config:snapshot.config,action:1,slot:o.slot}))}>Cancel</button>{cancelReason&&<p>Cancel unavailable: {cancelReason}.</p>}{feedback(`cancel-${o.slot}`)}<button disabled={!!recoverReason} onClick={()=>void run(()=>transact(`recover-${o.slot}`,{operation:'action',config:snapshot.config,action:4,slot:o.slot}))}>Recover unused commitment</button>{recoverReason&&<p>Recovery unavailable: {recoverReason}.</p>}{feedback(`recover-${o.slot}`)}</div>;
 })}
 <h3>Independent staking allocations</h3>{snapshot.allocations.map(a=>{
 const reason=commonReason||(a.terms.subarray(0,33).toString('hex')!==owner?'only the allocation owner can withdraw':a.withdrawal?'stake already withdrawn':a.pending?'withdrawal pending':!a.mature&&!stale?'stake has not matured':'');
 return <div key={a.id}><p>{a.id} · {assetAmount(snapshot.config.stakingAsset,BigInt(Buffer.from(a.terms).readUInt32LE(70)))} · effective lock {(Buffer.from(a.terms).readUInt32LE(74)&65535)*512}s · maturity MTP {new Date((a.sourceMtp+(Buffer.from(a.terms).readUInt32LE(74)&65535)*512)*1000).toISOString()} · {a.withdrawal?'withdrawn':a.pending?'withdrawal pending':a.mature?'mature':'locked'}</p><button disabled={!!reason} onClick={()=>void run(()=>transact(`withdraw-${a.id}`,{operation:'withdraw',config:snapshot.config,allocation:a.id}))}>Withdraw in owner wallet</button>{reason&&<p>Withdrawal unavailable: {reason}.</p>}{feedback(`withdraw-${a.id}`)}</div>;
 })}</div></section>}
 <details className="panel"><summary>Transaction recovery</summary><label><input type="checkbox" checked={showPending} onChange={e=>setShowPending(e.target.checked)}/>Display pending / unconfirmed (0-conf) operations</label><p>Vault creation and claims use one wallet approval. Direct genesis is one transaction; the covenant-controlled path broadcasts a signed parent and a permissionless child without a second signature. Pending state and allocations remain provisional until confirmed. Saved transactions remain recoverable after refresh.</p>{ops.filter(o=>showPending||o.stage==='confirmed').map(o=><article key={o.id}><p>{o.kind}: {o.kind==='offer'?offerDisplayStatus(o):o.step+' / '+o.stage} · {o.txid} {o.error}</p>{o.plan&&<p>Wallet review: {o.plan.label}. Fee: {o.plan.fee} BCH satoshis. Total BCH inputs: {o.plan.request.sourceOutputs.reduce((n,s)=>n+s.valueSatoshis,0n).toString()} satoshis. Token inputs: {o.plan.request.sourceOutputs.filter(s=>s.token).map(s=>`${s.token!.amount} raw units of ${Buffer.from(s.token!.category).toString('hex')}`).join('; ')||'none'}.</p>}<button disabled={v3Chain==='chipnet'||busy||o.step==='complete'&&!o.raw||(!o.raw&&!walletReady)} onClick={()=>void run(()=>o.raw?v3Call({operation:'inspect',id:o.id}):execute({operation:'resume',id:o.id}))}>{o.raw?'Reconcile transaction status':'Continue with explicit wallet approval'}</button>{!o.raw&&!o.txid&&!o.fundingRaw&&o.step!=='complete'&&<button disabled={v3Chain==='chipnet'||busy} onClick={()=>void run(()=>v3Call({operation:'discard',id:o.id}))}>Discard unsigned operation</button>}{o.raw&&o.step!=='complete'&&<button disabled={busy||!walletReady} onClick={()=>void run(()=>execute({operation:'rebroadcast',id:o.id}))}>Retry identical transaction</button>}{o.fundingRaw&&o.step!=='complete'&&<button disabled={busy||!walletReady} onClick={()=>void run(()=>execute({operation:'rebroadcastFunding',id:o.id}))}>Retry identical funding</button>}<details><summary>Public recovery configuration</summary><pre>{encode(o.config??o.parameters)}</pre></details></article>)}{claims.filter(c=>showPending||c.status==='confirmed').map(c=><p key={c.id}>Claim {c.id}: {c.status} {c.error}<button disabled={v3Chain==='chipnet'||busy} onClick={()=>void run(()=>v3Call({operation:'reconcileClaim',config:c.config,id:c.id}))}>Verify claim status</button></p>)}</details><p role={creating?undefined:"status"}>{creating?'':message}</p></div>;
}
