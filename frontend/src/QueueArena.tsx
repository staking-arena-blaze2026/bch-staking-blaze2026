import {creationValidation,offerValidation} from './queueFormValidation';
import {minimumReward,MAX_RELEASE} from '../../src/queue/model';
import {errorMessage} from '../../src/queue/funding';
import {confirmPreparation,QueuePreparationDialog,type PreparationConfirmation} from './QueuePreparationDialog';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {parameters,ZERO,rewardStatus,validateScore,type Offer,type Parameters,type Score} from '../../src/queue/model';
import type {Config,QueueIndexer} from '../../src/queue/chain';
import type {Operation,Intent} from '../../src/queue/wallet';
import {minimumMinutes,STAKING_UNIT_SECONDS,formatDuration} from '../../src/v3/time-policy';
import {queueCall} from './queueClient';
import {catalogRefreshMs,loadQueuePage,queueCatalogColumns,queueConfigStorage,queuePublishedStorage,savedQueuePublicIds} from './queueCatalog';
import {activeNetwork} from './activeNetwork';
import {useWalletTransactions} from './walletTransactions';
import {pairingRequestCheck,restoreWalletRequest} from './walletRequest';
import {prepareQueueCreate} from './queueCreatePlanning';
import {localDateTimeInput,parseLocalDateTime,localTimestamp} from './localTime';
import {assetAmount,assetLabel,assetQuantity,categoryAsset as asset,priorityRatio,wholeTokenRange,tokenBounds} from './assetAmounts';
import {useTokenMetadata} from './useAssetAmounts';
import {tokenIdentity} from './tokenMetadata';
import type {CatalogObservation} from '../../src/queue/catalog';
import type {QueueCandidate} from '../../src/queue/public-index';
import {markQueueRewardFailed,queueReward,rememberQueueReward} from './queueRewards';
import {QueueCatalogUpdated,QueueRewardCells} from './QueueCatalogData';
import {QueueReleaseSchedule} from './QueueReleaseSchedule';
import {DurationSummary} from './DurationSummary';
import {QueueCountCell} from './QueueCountCell';
import {queueCount,rememberQueueCount,setQueueCountError} from './queueCounts';
import {deriveWalletKey} from './walletDerivation';
import {queueArchiveStore} from './queueArchiveStore';
type FundingDetails={code?:string;reserved?:string;reservations?:{id:string;step:string}[];tokenBalance?:{category:string;required:bigint;available:bigint};operationId?:string;verification?:string};
type Snapshot=Awaited<ReturnType<QueueIndexer['reportedDisplay']>>;
type Owned=Awaited<ReturnType<QueueIndexer['archive']>>['rows'];
const encode=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
const storage=queueConfigStorage(activeNetwork);
export function parseQueueConfig(value:unknown):Config{
 const c=typeof value==='string'?JSON.parse(value):structuredClone(value);if(!c?.parameters||!c?.identity||!c?.anchor)throw Error('Invalid vault configuration');
 c.parameters.cap=BigInt(c.parameters.cap);parameters(c.parameters);delete c.offerCount;delete c.rewardSnapshot;
 if(![c.identity.vault,c.identity.queue,c.anchor.genesis].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s))||c.identity.vault===c.identity.queue||![c.identity.vault,c.identity.queue].every(s=>s!==ZERO&&![c.parameters.stakingCategory,c.parameters.rewardCategory].includes(s))||!/^(02|03)[a-f0-9]{64}$/.test(c.anchor.creator))throw Error('Invalid vault identity');return c;
}
function saved(){try{return JSON.parse(localStorage.getItem(storage)??'[]').flatMap((v:unknown)=>{try{return [parseQueueConfig(v)];}catch{return [];}});}catch{return [];} }
const id=(c:Config)=>c.anchor.genesis;
const unconfirmedVaultLabel='Unconfirmed (0-conf) · Provisional';
type Receipt=({kind:'vault';vaultId:string}|{kind:'offer';vaultId:string;offerId:string})&
 {txid?:string;dismissed?:boolean;observed?:boolean};
const receiptStorage='stake-arena-notices-'+activeNetwork;
const receiptRow=(receipt:Receipt)=>receipt.kind==='vault'?'vault-row-'+receipt.vaultId:'offer-row-'+receipt.offerId;
const sameReceipt=(a:Receipt,b:Receipt)=>a.vaultId===b.vaultId&&receiptRow(a)===receiptRow(b)&&(!a.txid||!b.txid||a.txid===b.txid);

function submissionReceipt(op:Operation,publicVault=false):Receipt|undefined{
 if(op.step!=='action'||!op.raw||!op.txid||(op.signing&&op.signing!=='signed'))return;
 const observedVault=op.intent.kind==='create'&&publicVault&&['signed','pending','confirmed'].includes(op.stage);
 if(!observedVault&&(op.error||(op.stage!=='pending'&&op.stage!=='confirmed')))return;
 if(op.intent.kind==='create'&&op.config&&id(op.config)===op.txid)return {kind:'vault',vaultId:op.txid,txid:op.txid};
 if(op.intent.kind==='insert'&&op.offerId)return {kind:'offer',vaultId:id(op.intent.config),offerId:op.offerId,txid:op.txid};
}
type SubmissionIntent=Extract<Intent,{kind:'create'|'insert'}>;
type InterruptedSubmission={route:string;id?:string;intent?:SubmissionIntent;verification?:string;preflight?:boolean};
function needsInspection(op:Operation){
 return op.stage==='conflict'||op.submissionRecovery==='inspect'||!op.raw&&
  (!!op.signedEvidence||op.signing==='uncertain'||op.signing==='requested');
}
/** Deterministic child IDs recover the sequence even if the parent link was
 * never saved. Keep a discarded unsigned child out of the active sequence. */
function submissionSequence(op:Operation,records:ReadonlyMap<string,Operation>){
 let root=op;
 const ancestors=new Set([root.id]);
 while(root.parent&&records.has(root.parent)&&!ancestors.has(root.parent)){
  root=records.get(root.parent)!;
  ancestors.add(root.id);
 }
 const steps=[root];
 let step=root;
 while(steps.length<3){
  const next=records.get(step.id+':next');
  if(!next||next.stage==='discarded'||next.parent!==step.id)break;
  steps.push(next);
  step=next;
 }
 return steps;
}

function savedReceipts():Receipt[]{
 try{
  const entries=JSON.parse(sessionStorage.getItem(receiptStorage)??'[]');
  const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  return Array.isArray(entries)?entries.filter(entry=>hex(entry?.vaultId)&&
   (entry.kind==='vault'||entry.kind==='offer'&&hex(entry.offerId))):[];
 }catch{return [];}
}

function SubmissionDialog({receipt,dismiss}:{receipt:Receipt;dismiss:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const dialog=ref.current!;
  dialog.showModal();
  return()=>dialog.close();
 },[]);
 return <dialog ref={ref} className="wallet-dialog queue-submission-dialog" aria-labelledby="queue-submission-title"
  onClick={dismiss} onCancel={event=>{event.preventDefault();dismiss();}}
  onKeyDown={event=>{
   if(!['Enter',' ','Escape'].includes(event.key))return;
   event.preventDefault();
   if(!event.repeat)dismiss();
  }}>
  {receipt.kind==='vault'?
   <h2 id="queue-submission-title" className="queue-vault-submission-title"><button type="button">Your vault has been created.</button></h2>:
   <><h2 id="queue-submission-title">Your offer has been submitted.</h2><button type="button">Continue</button></>}
 </dialog>;
}

export default function QueueArena(){
 const [route,setRoute]=useState(location.hash),creating=route==='#/v3'||route==='#/create',myOffers=route==='#/v3/my-offers'||route==='#/my-offers',selectedId=route.match(/^#\/(?:v3\/)?vault\/([a-f0-9]{64})$/)?.[1];
 const [savedConfigs,setConfigs]=useState<Config[]>(saved),[pages,setPages]=useState<string[]>([]),[page,setPage]=useState(0),[ready,setReady]=useState(false),[catalogError,setCatalogError]=useState('');
 const [publication,setPublication]=useState<{updatedAt:string;online?:number;pending?:Record<string,string>;errors?:string[]}>(),[publicIds,setPublicIds]=useState(()=>savedQueuePublicIds(activeNetwork));
 const [liveCandidates,setLiveCandidates]=useState<Map<string,QueueCandidate>>(()=>new Map());
 const liveCandidatesRef=useRef(liveCandidates);
 liveCandidatesRef.current=liveCandidates;
 const [refreshing,setRefreshing]=useState(false),[chainStatus,setChainStatus]=useState<Record<string,{confirmed?:boolean;error?:string}>>({});
 const catalogRequest=useRef(0),publishedPages=useRef(new Set<string>()),publicIdsRef=useRef(new Set(publicIds)),liveScan=useRef(false),mempoolScan=useRef(false);
 const discoveryPriority=useRef<string[]>([]);
 const [reports,setReports]=useState<Record<string,{snapshot?:Snapshot;error?:string;at:number}>>({});
 const snapshots=useRef(new Map<string,{snapshot:Snapshot;at:number}>());
 const [archives,setArchives]=useState<Record<string,{rows:Owned;at?:number;error?:string;updating?:boolean}>>({});
 const observedOffers=useRef(new Map<string,Set<string>>());
 const [receipts,setReceipts]=useState<Receipt[]>(savedReceipts);
 const retainedReceipts=useRef(receipts),journalRequest=useRef(0);
 const [highlight,setHighlight]=useState<Receipt>();
 const highlightTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function updateReceipts(update:(entries:Receipt[])=>Receipt[]){
  const entries=update(retainedReceipts.current);
  if(entries===retainedReceipts.current)return;
  retainedReceipts.current=entries;
  try{sessionStorage.setItem(receiptStorage,JSON.stringify(entries));}catch{}
  setReceipts(entries);
 }
 const [ops,setOps]=useState<Operation[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[review,setReview]=useState<Operation>(),[now,setNow]=useState(Date.now());
 const [refreshVersion,requestRefresh]=useState(0);
 const [verificationRetry,retryVerification]=useState(0),[retrying,setRetrying]=useState(false);
 const messageRoute=useRef(route);
 const [actionError,setActionError]=useState(''),[actionTechnical,setActionTechnical]=useState(''),[actionDetails,setActionDetails]=useState<FundingDetails>();
 const [interrupted,setInterrupted]=useState<InterruptedSubmission>();
 const recoveryDetails=useRef<HTMLDetailsElement>(null),errorDetails=useRef<HTMLDetailsElement>(null);
 const [confirmation,setConfirmation]=useState<PreparationConfirmation>(),confirmationRef=useRef<PreparationConfirmation|undefined>(undefined);
 useEffect(()=>{const open=(e:Event)=>{confirmationRef.current=(e as CustomEvent<PreparationConfirmation>).detail;setConfirmation(confirmationRef.current);},close=()=>{confirmationRef.current=undefined;setConfirmation(undefined);};window.addEventListener('arena-preparation-confirm',open);window.addEventListener('arena-preparation-close',close);return()=>{window.removeEventListener('arena-preparation-confirm',open);window.removeEventListener('arena-preparation-close',close);confirmationRef.current?.respond(false);};},[]);
 const wallet=useWalletTransactions(),walletRef=useRef(wallet);walletRef.current=wallet;
 const pairing=wallet?.pairing?.();
 const savedPaths=wallet?.publicPaths?.();
 const offlineOwner=useMemo(()=>{
  if(!savedPaths)return '';
  try{return deriveWalletKey(savedPaths,'receive',0,activeNetwork==='mainnet'?'mainnet':'testnet').publicKey;}catch{return '';}
  },[pairing?.identity,savedPaths?.find(path=>path.name==='receive')?.xpub]);
 let liveOwner='';try{liveOwner=wallet?.publicKey()??'';}catch{}
 const owner=pairing?.paired&&pairing.network===activeNetwork?liveOwner||offlineOwner:'';
 const [stakeKind,setStakeKind]=useState('bch'),[rewardKind,setRewardKind]=useState('bch'),[stakeCategory,setStakeCategory]=useState(''),[rewardCategory,setRewardCategory]=useState(''),[cap,setCap]=useState('0.00002000'),[interval,setReleaseInterval]=useState(String(minimumMinutes(activeNetwork))),[releases,setReleases]=useState('10'),[epoch,setEpoch]=useState(()=>localDateTimeInput(Date.now()+3600000));
 const [stake,setStake]=useState('0.00003000'),[duration,setDuration]=useState('1'),[offerFilter,setOfferFilter]=useState('All');
 const [rewardDrafts,setRewardDrafts]=useState<Record<string,string>>({});
 const configs=useMemo(()=>{
  const byId=new Map(savedConfigs.map(c=>[id(c),c]));
  for(const [vaultId,candidate] of liveCandidates)if(!publicIds.has(vaultId))byId.set(vaultId,candidate.config);
  return [...byId.values()];
 },[savedConfigs,liveCandidates,publicIds]);
 const catalogVaults=useMemo(()=>configs.filter(c=>publicIds.has(id(c))||liveCandidates.has(id(c))),[configs,publicIds,liveCandidates]);
 const isPublic=(vaultId:string)=>publicIds.has(vaultId)||liveCandidates.has(vaultId);
 const isProvisional=(vaultId:string)=>!publicIds.has(vaultId)&&liveCandidates.get(vaultId)?.status==='provisional';
 const confirmationLabel=(vaultId:string)=>isProvisional(vaultId)?unconfirmedVaultLabel:'Confirmed on-chain';
 const selectedConfig=configs.find(c=>id(c)===selectedId);
 const defaultReward=selectedConfig&&selectedConfig.parameters.rewardCategory!==ZERO?'1':'0.00002000';
 const reward=(selectedId?rewardDrafts[selectedId]:undefined)??defaultReward;
 const lifetime=useRef(new AbortController()),fingerprint=useRef(''),formEpoch=useRef(0),working=useRef(false);
 const nextFingerprint=encode({route,stakeKind,rewardKind,stakeCategory,rewardCategory,cap,interval,releases,epoch,stake,duration,reward});
 if(nextFingerprint!==fingerprint.current){fingerprint.current=nextFingerprint;formEpoch.current++;}
 const formFingerprint=fingerprint.current;
 useEffect(()=>{setReview(undefined);confirmationRef.current?.respond(false);},[formFingerprint,pairing?.identity,pairing?.generation]);
 const selected=selectedId?(reports[selectedId]??snapshots.current.get(selectedId)):undefined;
 const snapshot=selected?.snapshot,reportedAt=selected?.at??0;
 const selectedError=selectedId?reports[selectedId]?.error:undefined;
 const browsing=!creating&&!myOffers&&!selectedId;
 const submitted=ops.flatMap(op=>{
  const receipt=submissionReceipt(op,!!op.txid&&isPublic(op.txid));
  return receipt?[{op,receipt}]:[];
 });
 const submissionKind=creating?'create':selectedId?'insert':undefined;
 const activeInterruption=interrupted?.route===route?interrupted:undefined;
 const journal=new Map(ops.filter(op=>(!op.network||op.network===activeNetwork)&&
  (op.owner?.publicKey===owner||!!activeInterruption?.id&&(
   activeInterruption.id===op.id||activeInterruption.id.startsWith(op.id+':next')||op.id.startsWith(activeInterruption.id+':next')
  ))&&op.intent.kind===submissionKind&&['action','wallet-preparation'].includes(op.step)&&
  (op.intent.kind!=='insert'||id(op.intent.config)===selectedId)).map(op=>[op.id,op]));
 const interruptedStep=activeInterruption?.id?journal.get(activeInterruption.id):undefined;
 const target=interruptedStep&&(interruptedStep.stage!=='discarded'||interruptedStep.parent||
  activeInterruption?.verification==='unavailable'||activeInterruption?.verification==='synchronizing')?interruptedStep:undefined;
 const eligible=[...journal.values()].filter(op=>op.stage!=='discarded'&&
  (!activeInterruption?.intent||encode(op.intent)===encode(activeInterruption.intent)));
 const roots=new Map(eligible.map(op=>submissionSequence(op,journal)).map(steps=>[steps[0]!.id,steps]));
 const outstanding=[...roots.values()].filter(steps=>{
  const last=steps.at(-1)!;
  if(last.intent.kind==='create'&&last.txid&&isPublic(last.txid)&&receipts.some(r=>r.txid===last.txid))return false;
  return last.step==='wallet-preparation'||['review','signed','conflict'].includes(last.stage)||!!last.error||
   last.intent.kind==='create'&&last.stage==='pending'&&!!last.txid&&
   (!isPublic(last.txid)||isProvisional(last.txid))&&!receipts.some(r=>r.txid===last.txid);
 });
 const recoverySequence=target?submissionSequence(target,journal):outstanding.length===1?outstanding[0]:undefined;
 const recoveryTarget=recoverySequence?.at(-1);
 const publicRecovery=recoveryTarget?.intent.kind==='create'&&recoveryTarget.txid&&isPublic(recoveryTarget.txid)?
  submissionReceipt(recoveryTarget,true):undefined;
 useEffect(()=>{
  if(!publicRecovery)return;
  const registered=retainedReceipts.current.some(other=>sameReceipt(other,publicRecovery));
  if(registered&&!activeInterruption)return;
  if(!registered)updateReceipts(old=>[...old,publicRecovery]);
  setActionError('');setActionTechnical('');setActionDetails(undefined);setInterrupted(undefined);setMessage('');
 },[publicRecovery?.txid,activeInterruption?.id]);
 const availableVaults=new Set(configs.map(id));
 const pendingOffers=new Map<string,Map<string,Score>>();
 for(const {op,receipt} of submitted){
  if(receipt.kind!=='offer'||op.intent.kind!=='insert'||!op.intent.terms)continue;
  const retained=receipts.find(other=>sameReceipt(receipt,other));
  if(!retained||retained.observed||observedOffers.current.get(receipt.vaultId)?.has(receipt.offerId))continue;
  const offers=pendingOffers.get(receipt.vaultId)??new Map<string,Score>();
  offers.set(receipt.offerId,op.intent.terms);
  pendingOffers.set(receipt.vaultId,offers);
 }
 const pendingQueue=selectedId?pendingOffers.get(selectedId):undefined;
 const readyReceipt=!confirmation&&!highlight?receipts.find(receipt=>
  !receipt.dismissed&&availableVaults.has(receipt.vaultId)&&submitted.some(other=>sameReceipt(receipt,other.receipt))&&
  (receipt.kind==='vault'?isPublic(receipt.vaultId):pendingOffers.get(receipt.vaultId)?.has(receipt.offerId)||
   (reports[receipt.vaultId]??snapshots.current.get(receipt.vaultId))?.snapshot?.ordered.some(offer=>offer.id===receipt.offerId))
 ):undefined;
 function reveal(receipt:Receipt){
  updateReceipts(old=>old.map(other=>sameReceipt(other,receipt)?{...other,dismissed:true}:other));
  setHighlight(receipt);
  location.hash=receipt.kind==='vault'?'#/v3/offers':'#/v3/vault/'+receipt.vaultId;
 }
 useLayoutEffect(()=>{
  if(!highlight||highlightTimer.current!==undefined)return;
  if(highlight.kind==='vault'){
   if(!browsing)return;
   const index=catalogVaults.findIndex(c=>id(c)===highlight.vaultId);
   if(index<0){setHighlight(undefined);return;}
   const targetPage=Math.floor(index/20);
   if(page!==targetPage){setPage(targetPage);return;}
  }else if(selectedId!==highlight.vaultId)return;
  const row=document.getElementById(receiptRow(highlight));
  if(!row)return;
  row.focus({preventScroll:true});
  row.scrollIntoView?.({block:'center',behavior:'instant'});
  highlightTimer.current=setTimeout(()=>{
   highlightTimer.current=undefined;
   setHighlight(undefined);
  },5000);
 });
 useLayoutEffect(()=>()=>clearTimeout(highlightTimer.current),[]);
 const ownerConfigs=myOffers?configs:selectedConfig?[selectedConfig]:[];
 const ownerArchives=owner?ownerConfigs.map(c=>archives[owner+':'+id(c)]):[];
 const ownerOffers=owner?ownerConfigs.flatMap(c=>{
  const vaultId=id(c),report=reports[vaultId]??snapshots.current.get(vaultId),archive=archives[owner+':'+vaultId];
  const rows=new Map<string,{id:string;offer:Pick<Offer,'stake'|'reward'|'duration'>;status:string;canAct?:boolean;stale?:boolean;maturesAt?:number;claimTxid?:string}>();
  for(const o of archive?.rows??[]){
   if(o.offer.owner!==owner||o.status==='Waiting')continue;
   const matured=o.status==='Baked'&&o.maturesAt!==undefined&&o.checkedMtp>=o.maturesAt;
   const stale=!!archive?.error||now-(archive?.at??0)>90000;
   rows.set(o.id,{...o,status:o.status==='Baked'?matured?'Matured':'Locked':o.status,canAct:matured&&o.eligible&&!stale,stale,claimTxid:o.locked?.txid});
  }
  for(const o of report?.snapshot?.ordered??[]){
   if(o.owner!==owner)continue;
   const stale=!!reports[vaultId]?.error||now-report!.at>60000;
   if(rows.has(o.id)&&(stale||!archive?.error&&(archive?.at??0)>report!.at))continue;
   rows.set(o.id,{id:o.id,offer:o,status:'Waiting',canAct:!stale,stale});
  }
  for(const o of ops){
   if(o.intent.kind!=='insert'||id(o.intent.config)!==vaultId||o.owner?.publicKey!==owner||!o.raw||!o.offerId||rows.has(o.offerId)||
    observedOffers.current.get(vaultId)?.has(o.offerId)||['discarded','conflict'].includes(o.stage))continue;
   rows.set(o.offerId,{id:o.offerId,offer:o.intent.terms,status:'Pending'});
  }
  return [...rows.values()].map(row=>({config:c,row}));
 }):[];
 const visibleOwners=ownerOffers.filter(({row})=>offerFilter==='All'||row.status===offerFilter);
 const recoveryOps=myOffers?ops.filter(op=>owner&&op.owner?.publicKey===owner):ops;
 const catalogPage=useMemo(()=>catalogVaults.slice(page*20,(page+1)*20),[catalogVaults,page]);
 useEffect(()=>{
  if(!highlight)setPage(old=>Math.min(old,Math.max(0,Math.ceil(catalogVaults.length/20)-1)));
 },[catalogVaults.length,highlight]);
 const catalogIds=useMemo(()=>catalogPage.map(id),[catalogPage]);
 const displayConfigs=creating?[]:myOffers?visibleOwners.map(({config})=>config):selectedConfig?[selectedConfig]:catalogPage;
 const tokenMetadata=useTokenMetadata(activeNetwork,[
  ...displayConfigs.flatMap(c=>[c.parameters.stakingCategory,c.parameters.rewardCategory]),
  ...(creating&&rewardKind==='token'?[rewardCategory]:[]),
  ...recoveryOps.filter(op=>op.stage!=='discarded').flatMap(({intent})=>intent.kind==='create'&&intent.parameters?[intent.parameters.rewardCategory]:
   intent.kind==='insert'&&intent.config?[intent.config.parameters.stakingCategory,intent.config.parameters.rewardCategory]:[]),

 ]);
 const displayAsset=(category:string,amount?:bigint)=>{
  const a=asset(category),metadata=tokenMetadata(category);
  const label=amount===undefined?assetLabel(a,metadata):assetAmount(a,amount,metadata);
  return a.kind==='bch'?label:<span title={category}>{label}</span>;
 };
 function retain(values:Config[],replace=true){
  if(!values.length)return;
  setConfigs(old=>{
   const byId=new Map(old.map(c=>[id(c),c]));
   let changed=false;
   for(const c of values){
    const previous=byId.get(id(c));
    if(previous&&(!replace||encode(previous)===encode(c)))continue;
    byId.set(id(c),c);
    changed=true;
   }
   if(!changed)return old;
   const merged=[...byId.values()];
   try{localStorage.setItem(storage,encode(merged));}catch{}
   return merged;
  });
 }
 async function operations(signal?:AbortSignal){
  const request=++journalRequest.current;
  const list:Operation[]=signal?await queueCall({operation:'list'},[],signal):await queueCall({operation:'list'});
  if(signal?.aborted||request!==journalRequest.current)return list;
  setOps(list);
  retain(list.filter(o=>o.raw&&(o.config?.anchor.genesis||'config'in o.intent)).flatMap(o=>{
   try{return [parseQueueConfig(o.config??('config'in o.intent?o.intent.config:undefined))];}catch{return [];}
  }),false);
  return list;
 }
 function acceptPublished(data:{vaults:unknown[]}){
  const values=data.vaults.flatMap(v=>{
   try{
    const c=parseQueueConfig(v),published=v as {offerCount?:unknown;rewardSnapshot?:unknown};
    rememberQueueCount(activeNetwork,id(c),published.offerCount);
    rememberQueueReward(activeNetwork,id(c),published.rewardSnapshot);
    return [c];
   }catch{return [];}
  });
  for(const c of values)publicIdsRef.current.add(id(c));
  setPublicIds(new Set(publicIdsRef.current));
  try{localStorage.setItem(queuePublishedStorage(activeNetwork),JSON.stringify([...publicIdsRef.current]));}catch{}
  retain(values);
 }
 async function discover(path='index.json',fresh=false){
  const main=path==='index.json',request=main?++catalogRequest.current:catalogRequest.current;
  if(main)setRefreshing(true);
  try{
   const data=await loadQueuePage(activeNetwork,path,lifetime.current.signal,fresh);
   if(request!==catalogRequest.current)return;
   acceptPublished(data);
   if(main){
    setPublication(data);
    setPages((data.pages??[]).filter((p:string)=>!publishedPages.current.has(p)));
    setCatalogError('');
   }else {
    publishedPages.current.add(path);
    setPages(old=>old.filter(p=>p!==path));
   }
   return true;
  }catch(e){
   if(request===catalogRequest.current)setCatalogError(String(e));
  }finally{
   if(request===catalogRequest.current){
    if(main)setRefreshing(false);
    setReady(true);
   }
  }
 }
 async function discoverOnChain(){
  if(liveScan.current||activeNetwork==='regtest')return;
  liveScan.current=true;
  const signal=lifetime.current.signal;
  try{
   const result=await queueCall({operation:'discover',channel:'discovery',published:[...publicIdsRef.current]},[],signal);
   if(!signal.aborted)acceptPublished(result);
  }catch{/* The published and locally retained catalog stays available. */}
  finally{liveScan.current=false;}
 }
 async function discoverMempool(){
  if(mempoolScan.current||activeNetwork==='regtest')return;
  mempoolScan.current=true;
  const signal=lifetime.current.signal;
  try{
   const result:QueueCandidate[]=await queueCall({operation:'discoverMempool',
    published:[...publicIdsRef.current],priority:discoveryPriority.current},[],signal);
   if(!signal.aborted)setLiveCandidates(new Map(result.map(candidate=>{
    const config=parseQueueConfig(candidate.config);
    return [id(config),{...candidate,config}];
   })));
  }catch{if(!signal.aborted)setLiveCandidates(new Map());}
  finally{mempoolScan.current=false;}
 }
 async function readQueue(c:Config,channel:string,signal:AbortSignal,showOffers:boolean){
  const vaultId=id(c);
  try{
   const value:Snapshot=await queueCall({operation:'reportedQueue',config:c,channel,clock:channel==='selected'},[],signal);
   if(signal.aborted)return;
   const at=Date.now();
   const observed=observedOffers.current.get(vaultId)??new Set<string>();
   for(const offer of value.ordered)observed.add(offer.id);
   observedOffers.current.set(vaultId,observed);
   const newlyObserved=(receipt:Receipt)=>receipt.kind==='offer'&&receipt.vaultId===vaultId&&!receipt.observed&&observed.has(receipt.offerId);
   updateReceipts(old=>old.some(newlyObserved)?old.map(receipt=>newlyObserved(receipt)?{...receipt,observed:true}:receipt):old);
   rememberQueueCount(activeNetwork,vaultId,{network:activeNetwork,vaultId,waiting:value.ordered.length,updatedAt:new Date(at).toISOString()});
   setQueueCountError(activeNetwork,vaultId);
   const previous=snapshots.current.get(vaultId);
   const entry={snapshot:value.mtp===undefined&&previous?.snapshot.tip?.hash===value.tip?.hash&&previous?.snapshot.mtp!==undefined?{...value,mtp:previous.snapshot.mtp}:value,at};
   snapshots.current.delete(vaultId);snapshots.current.set(vaultId,entry);
   if(snapshots.current.size>100)snapshots.current.delete(snapshots.current.keys().next().value!);
   if(showOffers)setReports(old=>({...old,[vaultId]:entry}));
  }catch(e){
   if(signal.aborted)return;
   const detail=errorMessage(e);
   const label=/uniqueness|malformed|cyclic|orphan|stale link|ordering|collateral|unauthenticated|inconsistent|invalid root|incorrect reserve|duplicate queue/i.test(detail)?'Inconsistent queue data':'Queue data unavailable';
   setQueueCountError(activeNetwork,vaultId,label);
   if(showOffers)setReports(old=>({...old,[vaultId]:{...(old[vaultId]??snapshots.current.get(vaultId)??{at:0}),error:label}}));
   return (e as {recoveryExhausted?:boolean})?.recoveryExhausted;
  }
 }
 useEffect(()=>{const change=()=>{setRoute(location.hash);setNow(Date.now());};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 useEffect(()=>{
  if(creating)return;
  const clock=setInterval(()=>setNow(Date.now()),browsing?30000:1000);
  return()=>clearInterval(clock);
 },[selectedId,myOffers,creating,browsing]);
 useEffect(()=>{const interrupt=()=>{lifetime.current.abort();confirmationRef.current?.respond(false);};const restore=()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();};window.addEventListener('pagehide',interrupt);window.addEventListener('pageshow',restore);return()=>{window.removeEventListener('pagehide',interrupt);window.removeEventListener('pageshow',restore);};},[]);
 useEffect(()=>{
  lifetime.current=new AbortController();
  void discover().then(discoverOnChain);
  void discoverMempool();
  let readingJournal=false;
  const readJournal=async()=>{
   if(readingJournal)return;
   readingJournal=true;
   try{await operations(lifetime.current.signal);}catch{/* Transaction recovery retains its own durable journal. */}
   finally{readingJournal=false;}
  };
  void readJournal();
  const journalTimer=setInterval(()=>void readJournal(),5000);
  const mempoolTimer=setInterval(()=>void discoverMempool(),5000);
  const catalogTimer=setInterval(()=>{void discover('index.json',true).then(discoverOnChain);},60000);
  return()=>{lifetime.current.abort();clearInterval(journalTimer);clearInterval(mempoolTimer);clearInterval(catalogTimer);};
 },[]);
 const creations=ops.filter(o=>o.intent.kind==='create'&&o.step==='action'&&o.raw&&o.txid&&o.config?.anchor.genesis===o.txid&&o.stage!=='discarded');
 const creationIds=creations.filter(o=>o.stage!=='conflict').map(o=>o.txid!).join(',');
 useEffect(()=>{
  if(!creationIds)return;
  const controller=new AbortController();
  let active=true,running=false;
  const check=async()=>{
   if(running)return;
   running=true;
   try{
    for(const txid of creationIds.split(',')){
     if(!active)break;
     try{
      const status=await queueCall({operation:'creationStatus',channel:'creation',txid},[],controller.signal);
      if(active)setChainStatus(old=>({...old,[txid]:status}));
     }catch(e){
      if(active)setChainStatus(old=>({...old,[txid]:{...old[txid],error:errorMessage(e)}}));
     }
    }
   }finally{running=false;}
  };
  void check();
  const timer=setInterval(()=>void check(),30000);
  return()=>{active=false;controller.abort();clearInterval(timer);};
 },[creationIds]);
 const awaitingPublication=creations.some(o=>!publicIds.has(o.txid!));
 useEffect(()=>{
  if(!awaitingPublication||!publication)return;
  let active=true;
  const check=async()=>{
   for(const path of pages){
    if(!active||creations.every(o=>publicIdsRef.current.has(o.txid!)))break;
    try{
     const data=await loadQueuePage(activeNetwork,path,lifetime.current.signal);
     if(active)acceptPublished(data);
    }catch{break;}
   }
  };
  void check();
  return()=>{active=false;};
 },[awaitingPublication,creationIds,publication]);
 useLayoutEffect(()=>{if(ready||catalogVaults.length||creating||myOffers||selectedId)document.getElementById('arena-public-preview')?.remove();},[ready,catalogVaults.length,creating,myOffers,selectedId]);
 useEffect(()=>{if((myOffers||selectedId&&!selectedConfig)&&pages.length)void discover(pages[0]);},[myOffers,selectedId,!!selectedConfig,pages.join(',')]);
 const configRevision=encode(configs),selectedRevision=selectedConfig?encode(selectedConfig):'';
 useEffect(()=>{
  if(!selectedConfig)return;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  setRetrying(false);
  const run=async()=>{
   let exhausted=false;
   if(!document.hidden){
    setRetrying(true);
    exhausted=!!await readQueue(selectedConfig,'selected',controller.signal,true);
    if(!controller.signal.aborted)setRetrying(false);
   }
   if(!controller.signal.aborted&&!exhausted)timer=setTimeout(run,15000);
  };
  void run();
  return()=>{controller.abort();clearTimeout(timer);};
 },[selectedRevision,refreshVersion,verificationRetry]);
 const catalogRevision=encode(catalogPage);
 useEffect(()=>{
  if(!browsing||!ready||!catalogPage.length)return;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>,running=false;
  const run=async()=>{
   if(running)return;
   clearTimeout(timer);
   running=true;
   try{
    if(document.hidden)return;
    const due=(updatedAt?:string)=>!updatedAt||Date.now()-Date.parse(updatedAt)>=catalogRefreshMs;
    const targets=catalogPage.map(config=>{
     const reward=queueReward(activeNetwork,id(config));
     return {config,reward:!reward?.schedule||due(reward.updatedAt),count:due(queueCount(activeNetwork,id(config))?.updatedAt)};
    }).filter(t=>t.reward||t.count);
    if(!targets.length)return;
    const pending=new Map(targets.map(target=>[id(target.config),{reward:target.reward,count:target.count}]));
    const observe=({vaultId,kind,reward,count}:CatalogObservation)=>{
     const fields=pending.get(vaultId);
     if(controller.signal.aborted||!fields?.[kind])return;
     if(reward||count)fields[kind]=false;
     if(kind==='reward'){
      if(reward)rememberQueueReward(activeNetwork,vaultId,reward);
      else markQueueRewardFailed(activeNetwork,vaultId);
     }else{
      if(count)rememberQueueCount(activeNetwork,vaultId,count);
      setQueueCountError(activeNetwork,vaultId,count?undefined:'Queue data unavailable');
     }
    };
    try{await queueCall({operation:'catalog',targets},[],controller.signal,observe);}
    catch{/* Keep the latest observations when the provider is unavailable. */}
    for(const [vaultId,fields] of pending){
     if(fields.reward)observe({vaultId,kind:'reward'});
     if(fields.count)observe({vaultId,kind:'count'});
    }
   }finally{
    running=false;
    if(!controller.signal.aborted)timer=setTimeout(run,catalogRefreshMs);
   }
  };
  const visible=()=>{if(!document.hidden)void run();};
  void run();
  document.addEventListener('visibilitychange',visible);
  return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[browsing,ready,catalogRevision,refreshVersion]);
 useEffect(()=>{
  if(!myOffers||!owner)return;
  const controller=new AbortController(),values=configs;
  let timer:ReturnType<typeof setTimeout>;
  const run=async()=>{
   if(!document.hidden){
    let next=0;
    await Promise.all([0,1].map(async lane=>{
     while(next<values.length&&!controller.signal.aborted)await readQueue(values[next++]!,'market-'+lane,controller.signal,true);
    }));
   }
   if(!controller.signal.aborted)timer=setTimeout(run,20000);
  };
  void run();
  return()=>{controller.abort();clearTimeout(timer);};
 },[myOffers,configRevision,myOffers&&!!owner,refreshVersion]);
 useEffect(()=>{
  if(!owner||!myOffers&&!selectedConfig)return;
  const controller=new AbortController(),values=myOffers?configs:[selectedConfig!];
  let timer:ReturnType<typeof setTimeout>;
  const run=async()=>{
   if(!document.hidden)for(const c of values){
    if(controller.signal.aborted||working.current)break;
    const key=owner+':'+id(c);
    setArchives(old=>({...old,[key]:{...old[key],rows:old[key]?.rows??[],updating:true}}));
    void queueArchiveStore(activeNetwork).then(store=>store.read(c,owner)).then(cached=>{
     if(!controller.signal.aborted&&cached?.rows.length)setArchives(old=>old[key]?.updating&&!old[key].rows.length?
      {...old,[key]:{...old[key],rows:cached.rows,error:'Saved history is awaiting reconciliation'}}:old);
    }).catch(()=>{});
    try{
     const rows:Owned=await queueCall({operation:'owned',config:c,owner,channel:'owners'},[],controller.signal);
     if(!controller.signal.aborted)setArchives(old=>({...old,[key]:{rows,at:Date.now()}}));
    }catch{
     if(!controller.signal.aborted)setArchives(old=>({...old,[key]:{rows:old[key]?.rows??[],error:'Offer history unavailable'}}));
    }
   }
   if(!controller.signal.aborted)timer=setTimeout(run,45000);
  };
  void run();
  return()=>{controller.abort();clearTimeout(timer);};
 },[owner,myOffers,myOffers?configRevision:selectedRevision,refreshVersion]);
 useEffect(()=>{const progress=(e:Event)=>{if(working.current)setMessage(String((e as CustomEvent).detail));};window.addEventListener('arena-wallet-progress',progress);return()=>window.removeEventListener('arena-wallet-progress',progress);},[]);
 function showFailure(error:unknown){
  const full=errorMessage(error),data=error as {summary?:string;details?:FundingDetails};
  const balance=data.details?.tokenBalance;
  const short=balance?`Insufficient token balance. This transaction needs ${assetAmount(asset(balance.category),balance.required,tokenMetadata(balance.category))}. The selected inputs contain ${assetAmount(asset(balance.category),balance.available,tokenMetadata(balance.category))}.`:data.summary??(data.details?.reserved&&BigInt(data.details.reserved)>0n?`An old request reserves ${data.details.reserved} satoshis. Resolve it to continue creating this new vault.`:full);
  setActionError(short);setActionTechnical(short===full?'':full);setActionDetails(data.details);
 }
 const recoveryPoll=useRef(false);
 useEffect(()=>{
  const pending=ops.filter(o=>o.step==='wallet-recovery'&&o.raw&&!['confirmed','conflict'].includes(o.stage));if(!pending.length)return;
  let active=true;const run=async()=>{if(working.current||recoveryPoll.current)return;recoveryPoll.current=true;try{for(const op of pending){const updated:Operation=await queueCall({operation:'reconcileRecovery',id:op.id});if(active){setOps(old=>old.map(o=>o.id===updated.id?updated:o));if(!working.current&&(updated.recoveryResolved||updated.stage==='confirmed'||updated.stage==='conflict'))setMessage(old=>old.startsWith('Resolution ')||old.startsWith('Old request ')?updated.recoveryResolved?'Old request resolved. Continue creating your new vault.':updated.stage==='confirmed'?'Wallet self-send confirmed. Old covenant references still need inspection.':'Resolution could not complete. Inspect the old request before continuing.':old);}}if(active)await operations();}catch{/* Retained journal remains available for explicit status inspection. */}finally{recoveryPoll.current=false;}};
  void run();const timer=setInterval(()=>void run(),10000);return()=>{active=false;clearInterval(timer);};
 },[ops.filter(o=>o.step==='wallet-recovery').map(o=>o.id+o.stage).join(',')]);
 useEffect(()=>{if(actionDetails?.reservations?.some(r=>ops.some(o=>o.recoveryResolved&&o.recovery?.operationId===r.id))){setActionError('');setActionTechnical('');setActionDetails(undefined);}},[actionDetails,ops]);
 async function act(request:Record<string,unknown>,steps?:Operation[]){
  if(working.current)return;
  messageRoute.current=route;setMessage('');working.current=true;setBusy(true);
  const captured=fingerprint.current,capturedEpoch=formEpoch.current,signal=lifetime.current.signal;
  const readWallet=()=>walletRef.current;
  const unchanged=()=>fingerprint.current===captured&&formEpoch.current===capturedEpoch;
  const intent=request.intent as Intent|undefined;
  const interruptedIntent=intent?.kind==='create'||intent?.kind==='insert'?intent:undefined;
  const recoveringSubmission=!!interruptedIntent||!!steps;
  const currentPublic=(txid:string)=>publicIdsRef.current.has(txid)||liveCandidatesRef.current.has(txid);
  const prioritize=(txid:string)=>{
   discoveryPriority.current=[txid,...discoveryPriority.current.filter(v=>v!==txid)].slice(0,20);
   void discoverMempool();
  };
  let result:Operation|undefined;
  try{
  if(!steps)setInterrupted(undefined);
  if(steps){
   setInterrupted({route,id:steps.at(-1)!.id});
   setMessage('Waiting for network verification…');
   const last=steps.at(-1)!;
   if(last.intent.kind==='create'&&last.step==='action'&&last.txid){
    prioritize(last.txid);
    if(submissionReceipt(last,currentPublic(last.txid))&&currentPublic(last.txid))result=last;
   }
   // A verified final submission settles the sequence. Otherwise check the
   // remaining preparation ancestry before reopening the original wallet.
   const checks=last.step==='action'&&last.raw?[last,...steps.slice(0,-1)]:steps;
   for(const step of checks){
    if(result)break;
    const checked:Operation=await queueCall({operation:'inspectSubmission',id:step.id});
    signal.throwIfAborted();
    if(!unchanged())throw Error('Wallet request changed. Review the current terms and continue again.');
    if(checked.intent.kind==='create'&&checked.txid&&currentPublic(checked.txid)&&submissionReceipt(checked,true))result=checked;
    else if(needsInspection(checked)||checked.submissionRecovery==='waiting-verification'||checked.step==='action'&&checked.raw&&!checked.error)result=checked;
   }
  }
  let draft:Operation|undefined;
  if(request.operation==='prepare'&&intent?.kind==='create'){
   const check=pairingRequestCheck(readWallet,unchanged,signal);
   const wallet=readWallet();
   const paths=wallet?.publicPaths?.();
   if(wallet?.publicPaths&&!paths?.length&&!wallet.pairing?.().live){
    wallet.restore?.();
    throw Error('This pairing has no usable saved wallet addresses for this network. Open Cashonize, then click Create Vault again once connected.');
   }
   if(paths?.length){
    setMessage('Estimating vault costs from reported wallet funds…');
    draft=await prepareQueueCreate(intent,paths,check);
    check();
    if(!draft.quote)throw Error('Vault creation costs are unavailable. Try again.');
    setReview(draft);
    setMessage('Review vault creation costs');
    const proceed=await confirmPreparation(draft.quote,signal);
    check();
    if(!proceed){setReview(undefined);setMessage('Vault creation cancelled.');return;}
   }
  }
  if(!result){
   const restored=await restoreWalletRequest(readWallet,unchanged,signal,()=>setMessage(steps?'Open the original Cashonize wallet to continue the saved request…':draft?'Open Cashonize to sign…':intent?.kind==='create'?'Open Cashonize to load wallet addresses…':'Restoring wallet…'));
   restored.check();
   if(!restored.wallet.queue)throw Error('A compatible queue wallet is required');
   setMessage('Checking request and wallet inputs…');
   result=await restored.wallet.queue(draft?{operation:'continueCreate',draft}:request,restored.check);
  }
  if(!result)throw Error('Wallet operation status unavailable');
  if(result.config?.anchor.genesis&&result.raw)retain([result.config]);
  const publiclyListed=!!result.txid&&currentPublic(result.txid);
  const receipt=submissionReceipt(result,publiclyListed);
  if(receipt){
   if(result.intent.kind==='insert')retain([result.intent.config],false);
   if(receipt.kind==='vault')prioritize(receipt.vaultId);
   updateReceipts(old=>old.some(other=>sameReceipt(other,receipt))?old:[...old,receipt]);
  }
  if(result.id){
   const completed=result;
   journalRequest.current++;
   setOps(old=>[completed,...old.filter(op=>op.id!==completed.id)]);
  }
  if(result.error&&!receipt){
   showFailure(Error(result.error));
   if(recoveringSubmission)setInterrupted({route,id:result.id,intent:interruptedIntent});
  }else{
   setActionError('');setActionTechnical('');setActionDetails(undefined);setInterrupted(undefined);
  }
  setMessage(result.submissionRecovery==='waiting-verification'&&!receipt?'Waiting for network verification…':
   receipt?.kind==='vault'?(publiclyListed?'':'Waiting for public listing…'):
   result.intent.kind==='recover'?(result.recoveryResolved?'Old request resolved. Continue creating your new vault.':result.raw?'Resolution submitted. Waiting for confirmation before releasing old reservations.':'Review the resolution before approving it.'):
   result.error?'':(!['action','wallet-preparation'].includes(result.step)?'Inspected · '+result.stage:result.raw?'Submitted':'Prepared')+' · '+(result.txid??result.plan.label));
  requestRefresh(version=>version+1);
  await operations().catch(()=>{/* The result remains available until the journal can be read. */});
 }catch(e){
  showFailure(e);setMessage('');
  const details=(e as {details?:FundingDetails})?.details;
  const verification=details?.verification??(/conflicting blockchain evidence|known double.spend|competing spend|reorganization/i.test(errorMessage(e))?'conflict':
   /electrum.*(?:provider|connection|timeout)|provider unavailable|verified provider|network verification|timed out|tip changed/i.test(errorMessage(e))?'unavailable':undefined);
  const saved=await operations().catch(()=>undefined);
  if(recoveringSubmission)setInterrupted({route,id:details?.operationId??steps?.at(-1)?.id,intent:interruptedIntent,verification,
   preflight:!!saved&&!!interruptedIntent&&!details?.operationId&&(verification==='unavailable'||verification==='synchronizing')});
 }finally{working.current=false;setBusy(false);}}
 const prepare=(intent:Intent)=>{setReview(undefined);return act({operation:'prepare',intent});};
 useEffect(()=>{const receive=(e:Event)=>setReview((e as CustomEvent<Operation>).detail);window.addEventListener('arena-queue-review',receive);return()=>window.removeEventListener('arena-queue-review',receive);},[]);
 const canRequest=!!pairing?.paired&&pairing.network===activeNetwork;
 const creation=creationValidation({stakingCategory:stakeKind==='bch'?ZERO:stakeCategory,rewardCategory:rewardKind==='bch'?ZERO:rewardCategory,cap,interval,releases,epoch},activeNetwork,tokenMetadata(rewardCategory));
 if(stakeKind==='token'&&stakeCategory===ZERO)creation.errors.stakingCategory='Choose a nonzero CashToken category.';
 if(rewardKind==='token'&&rewardCategory===ZERO)creation.errors.rewardCategory='Choose a nonzero CashToken category.';
 const creationPreview=Object.keys(creation.errors).length?undefined:creation.parameters;
 const offer:ReturnType<typeof offerValidation>=selectedConfig?offerValidation(selectedConfig.parameters,{stake,reward,duration},snapshot?.state.reserve,tokenMetadata(selectedConfig.parameters.stakingCategory),tokenMetadata(selectedConfig.parameters.rewardCategory)):{errors:{},terms:undefined,priorityTerms:undefined,lockSeconds:undefined};
 const terms=offer.terms,termsError=Object.values(offer.errors).join(' ');
 const showPriority=(score:Score,config:Config)=>{
  const staking=asset(config.parameters.stakingCategory),reward=asset(config.parameters.rewardCategory);
  const numerator=score.stake*BigInt(score.duration/STAKING_UNIT_SECONDS);
  const metadataFor=(a:ReturnType<typeof asset>)=>a.kind==='token'?tokenMetadata(a.category):undefined;
  const quotient=Number(assetQuantity(staking,numerator,metadataFor(staking)))/Number(assetQuantity(reward,score.reward,metadataFor(reward)));
  const exact=priorityRatio(staking,numerator,reward,score.reward,metadataFor);
  return <span title={exact}>{Number(quotient.toPrecision(8)).toString()}</span>;
 };
 function create(){if(creationPreview&&!continuingSubmission)void prepare({kind:'create',parameters:creationPreview});}
 const releaseCategory=rewardKind==='bch'?ZERO:rewardCategory;
 const releaseAsset=asset(releaseCategory),releaseMetadata=tokenMetadata(releaseCategory);
 const bounds=tokenBounds(minimumReward(releaseCategory),MAX_RELEASE,releaseMetadata);
 const rewardMinimumLabel=releaseAsset.kind==='bch'?assetAmount(releaseAsset,minimumReward(releaseCategory)):
  bounds&&bounds.last>=bounds.first?`${bounds.first} ${assetLabel(releaseAsset,releaseMetadata)}`:undefined;
 const releaseLabel=rewardMinimumLabel?`Reward per release (min. ${rewardMinimumLabel})`:'Reward per release';
 const releaseRange=wholeTokenRange(releaseAsset,minimumReward(releaseCategory),MAX_RELEASE,releaseMetadata);
 const fieldError=(field:string,error?:string)=>error?<small id={'queue-error-'+field} role="alert" aria-label={field+' error'}>{error}</small>:null;
 async function cancelUnsigned(id:string){if(working.current)return;messageRoute.current=route;working.current=true;setBusy(true);try{await queueCall({operation:'discard',id});await operations();setActionError('');setActionTechnical('');setActionDetails(undefined);setMessage('Unsigned request cancelled. You can create your vault again.');}catch(error){showFailure(error);}finally{working.current=false;setBusy(false);}}
 const unsignedRequests=(actionDetails?.reservations??[]).filter(r=>ops.some(o=>o.id===r.id&&['action','wallet-preparation','wallet-recovery'].includes(o.step)&&o.owner.publicKey===owner&&!o.raw&&!o.signedEvidence&&['unsigned','rejected'].includes(o.signing)&&o.stage==='review'));
 const oldRequests=(actionDetails?.reservations??[]).filter(o=>['seed-funding','queue-funding'].includes(o.step));
 const recoveries=ops.filter(o=>o.intent.kind==='recover'&&o.owner.publicKey===owner&&o.stage!=='discarded');
 const recoveryPanel=recoveries.length>0&&<section className="panel"><h2>Old request resolution</h2>{recoveries.map(o=><article key={o.id}>
  {o.recoveryResolved?<><p>The old request is resolved. Its wallet funds are available for your new vault.</p>{creating&&<button type="button" disabled={busy||!canRequest||!creationPreview} onClick={()=>{setActionError('');setActionDetails(undefined);setActionTechnical('');create();}}>Continue Create Vault</button>}</>:o.stage==='confirmed'?<><p>The wallet self-send confirmed. Old covenant references still need inspection before they can be released; other available wallet funds can be used for a new vault.</p>{o.error&&<p>{o.error}</p>}</>:o.stage==='conflict'?<p>Another transaction spent the old inputs first. Inspect the old request before continuing.</p>:<><p>{o.raw?'Waiting for confirmation. Old reservations remain protected until the resolution confirms.':['uncertain','requested'].includes(o.signing)?'Wallet approval status is unknown. Inspect this resolution before trying again.':'Resolution is awaiting your review or wallet approval.'}</p><button type="button" disabled={busy||!canRequest} onClick={()=>void act({operation:'resume',id:o.id})}>Check resolution status</button>{o.raw&&o.stage==='signed'&&<button type="button" disabled={busy||!canRequest} onClick={()=>void act({operation:'resume',id:o.id,retry:true})}>Retry signed resolution</button>}</>}
  {o.txid&&<small>Resolution transaction: {o.txid}</small>}
 </article>)}</section>;
 const blockedStep=recoverySequence?.find(needsInspection);
 const inspectOnly=activeInterruption?.verification==='conflict'||!!blockedStep||
  !!activeInterruption&&!target&&outstanding.length>1;
 const inspectionReason=blockedStep?.error??(blockedStep?.stage==='conflict'?'The saved transaction conflicts with blockchain evidence.':
  blockedStep?'Check the original Cashonize request before asking for another signature.':
  outstanding.length>1?'More than one saved submission needs inspection.':undefined);
 const draftIntent=creating&&creationPreview?{kind:'create',parameters:creationPreview}:
  selectedConfig&&terms?{kind:'insert',config:selectedConfig,terms}:undefined;
 const retryPreflight=!!activeInterruption?.preflight&&!!draftIntent&&encode(activeInterruption.intent)===encode(draftIntent)&&!outstanding.length;
 function inspectTransaction(){
  const saved=blockedStep??recoveryTarget;
  if(recoveryDetails.current&&(saved||outstanding.length>1)){
   recoveryDetails.current.open=true;
   const article=saved?document.getElementById('queue-operation-'+saved.id):undefined;
   article?.querySelector('details')?.setAttribute('open','');
   article?.focus({preventScroll:true});
   article?.scrollIntoView?.({block:'nearest'});
  }else if(errorDetails.current)errorDetails.current.open=true;
 }
 const resumeAction=!publicRecovery&&(recoverySequence||retryPreflight||inspectOnly&&activeInterruption)?
  inspectOnly?<button type="button" onClick={inspectTransaction}>Inspect Transaction</button>:
  <button type="button" className="v3-primary" disabled={busy||!recoverySequence&&!canRequest} onClick={()=>{
   if(recoverySequence)void act({operation:'resume',id:recoverySequence[0]!.id,retry:true,recoverSubmission:true},recoverySequence);
   else if(activeInterruption?.intent)void prepare(activeInterruption.intent);
  }}>{submissionKind==='create'?'Resume Vault Creation':'Resume Offer Submission'}</button>:null;
 const showActionError=!!actionError&&messageRoute.current===route;
 const continuingSubmission=!!recoveryTarget&&!publicRecovery&&(!inspectOnly||showActionError);
 const actionFeedback=<>
  {!canRequest&&<p role="alert">Connect a compatible Cashonize wallet to continue.</p>}
  {busy&&<p>Transaction action in progress.</p>}
  {showActionError?<div role="alert" className="transaction-error">
   <p>{actionError}</p>
   {inspectOnly&&inspectionReason&&inspectionReason!==actionError&&<p>{inspectionReason}</p>}
   <div className="transaction-error-actions">{resumeAction}<button type="button" onClick={()=>{setActionError('');setActionTechnical('');setActionDetails(undefined);}}>Dismiss Transaction Error</button></div>
   {oldRequests.map(o=><button key={o.id} type="button" disabled={busy||!canRequest} onClick={()=>void prepare({kind:'recover',operationId:o.id})}>Resolve old request</button>)}
   {unsignedRequests.map(o=><button key={o.id} type="button" disabled={busy} onClick={()=>void cancelUnsigned(o.id)}>Cancel unsigned request</button>)}
   {(actionTechnical||inspectOnly)&&<details ref={errorDetails}><summary>Technical details</summary><p>{actionTechnical||actionError}</p></details>}
  </div>:resumeAction&&<div className="transaction-error-actions">{inspectOnly&&inspectionReason&&<p role="status">{inspectionReason}</p>}{resumeAction}</div>}
 </>;
 const head=snapshot?.ordered[0],headStatus=snapshot?.mtp!==undefined&&head?rewardStatus(snapshot.config.parameters,snapshot.state,head.reward,snapshot.mtp-1):undefined;
 const ownerSection=<section className="panel queue-my-offers"><h2>{myOffers?'My Offers':'My offers in this Vault'}</h2>{!owner?<p>Connect your wallet to find your offers.</p>:<>
  <p title={owner}>Wallet {owner.slice(0,12)}…{owner.slice(-8)} · {activeNetwork==='mainnet'?'Mainnet':activeNetwork==='chipnet'?'Chipnet':'Regtest'}</p>
  <div className="queue-offer-filters" role="group" aria-label="Offer status">{['All','Pending','Waiting','Locked','Matured','Finished','Cancelled'].map(s=><button key={s} aria-pressed={offerFilter===s} onClick={()=>setOfferFilter(s)}>{s}</button>)}</div>
  {ownerArchives.some(entry=>!entry||entry.updating)&&<p role="status">Checking offer history…</p>}
  {ownerArchives.some(entry=>entry?.error)&&<p role="status">Some offer histories are unavailable. Retained history may be stale.</p>}
  {myOffers&&ownerConfigs.some(c=>reports[id(c)]?.error)&&<p role="status">Some queues are unavailable or inconsistent. Retained offers may be stale.</p>}
  {!visibleOwners.length&&<p>{ownerConfigs.some(c=>!reports[id(c)])?'Loading active offers…':'No matching offers in the queues checked so far.'}</p>}
  {visibleOwners.map(({config:c,row:o})=><article key={id(c)+o.id}><h3><a href={'#/v3/vault/'+id(c)}>Vault {id(c).slice(0,12)}</a> · Offer {o.id.slice(0,12)}</h3>
   <div className="queue-offer-summary">
    <div>
     <p><strong>{o.status}</strong>{o.status==='Waiting'?' · Provider-reported queue':o.status==='Pending'?' · Awaiting appearance in the queue':''}{o.stale?' · Stale':''}</p>
     <p>Stake: {displayAsset(c.parameters.stakingCategory,o.offer.stake)} · Reward: {displayAsset(c.parameters.rewardCategory,o.offer.reward)}</p>
    </div>
    {o.status==='Waiting'&&<button type="button" disabled={!canRequest||busy||!o.canAct} onClick={()=>void prepare({kind:'cancel',config:c,offerId:o.id})}>Cancel offer</button>}
   </div>
   <DurationSummary seconds={o.offer.duration}/>
   {o.status==='Locked'&&<p>Reward paid. {o.maturesAt?`Stake matures at blockchain MTP ${localTimestamp(o.maturesAt)}.`:'Awaiting allocation confirmation.'}</p>}
   {o.status==='Matured'&&o.canAct&&<button disabled={!canRequest||busy} onClick={()=>void prepare({kind:'withdraw',config:c,offerId:o.id,...(o.claimTxid?{claimTxid:o.claimTxid}:{})})}>Get my stake back</button>}
  </article>)}
 </>}</section>;
 const discoveryControls=<>
  <button type="button" disabled={refreshing} onClick={()=>{void discover('index.json',true).then(discoverOnChain);void discoverMempool();}}>Refresh public discovery</button>
  <p role="status">{publication?.updatedAt&&Number.isFinite(Date.parse(publication.updatedAt))?<>Public index updated <time dateTime={publication.updatedAt}>{new Date(publication.updatedAt).toLocaleString(undefined,{timeZoneName:'short'})}</time>.</>:'Public index update time unavailable.'} {refreshing?'Checking for an update…':catalogError}{publication?.online===0&&' Index providers were unavailable during the last scan.'}</p>
 </>;
 const creationStatus=(o:Operation)=>{
  const txid=o.txid!,chain=chainStatus[txid],listed=isPublic(txid);
  const confirmed=o.stage!=='conflict'&&(chain?.confirmed??(o.stage==='confirmed'));
  const submitted=confirmed||chain?.confirmed===false||['pending','confirmed'].includes(o.stage);
  const reason=catalogError?'The published index could not be loaded.':
   publication?.pending?.[txid]??(publication?.online===0?'Index providers were unavailable during the last publication.':
   publication?'The latest checked public index has no listing for this transaction yet.':'The published index has not been checked yet.');
  return <article key={o.id}>
   <p><a href={'#/v3/vault/'+txid}>Vault {txid.slice(0,12)}</a> · Locally saved · {!confirmed&&!listed&&(submitted?'Submitted · ':'Submission unverified · ')}{listed?confirmationLabel(txid):confirmed?'Confirmed on-chain':'Confirmation unverified'} · {listed?'Publicly listed':'Public listing pending'}</p>
   {confirmed&&!listed&&<p role="alert">This vault is confirmed and its listing in the published index is pending. {reason}</p>}
   {chain?.error&&<p role="status">Latest on-chain check unavailable. {chain.error}</p>}
  </article>;
 };
 return <div className="v3-arena">
 {readyReceipt&&<SubmissionDialog key={readyReceipt.txid??receiptRow(readyReceipt)} receipt={readyReceipt} dismiss={()=>reveal(readyReceipt)}/>}
 {confirmation&&<QueuePreparationDialog request={confirmation}/>}<nav className="v3-tabs" aria-label="Vault actions"><a className="create-vault-tab" aria-current={creating?'page':undefined} href="#/v3">Create Vault</a><a aria-current={!creating&&!myOffers?'page':undefined} href="#/v3/offers">Browse All Vaults</a></nav>
 {!creating&&<>{(selectedId||myOffers)&&message&&messageRoute.current===route&&<p role="status">{message}</p>}{recoveryPanel}{!selectedConfig&&actionFeedback}</>}
 {creating?<><form className="form-panel" noValidate onSubmit={e=>{e.preventDefault();create();}}><h1>Create Vault</h1><p>Create the vault, queue and complete reward reserve together. Wallet preparation runs automatically if needed.</p><fieldset disabled={busy}><div className="form-grid"><div className="queue-asset-fields"><label>Staking asset<select aria-label="Staking asset" value={stakeKind} onChange={e=>setStakeKind(e.target.value)}><option value="bch">BCH</option><option value="token">CashToken</option></select></label>{stakeKind==='token'&&<label>Staking token category<input aria-label="Staking token category" aria-describedby="queue-error-stakingCategory" aria-invalid={!!creation.errors.stakingCategory} value={stakeCategory} onChange={e=>setStakeCategory(e.target.value)} maxLength={64}/>{fieldError('stakingCategory',creation.errors.stakingCategory)}</label>}</div><div className="queue-asset-fields"><label>Reward asset<select aria-label="Reward asset" value={rewardKind} onChange={e=>setRewardKind(e.target.value)}><option value="bch">BCH</option><option value="token">CashToken</option></select></label>{rewardKind==='token'&&<label>Reward token category<input aria-label="Reward token category" aria-describedby="queue-error-rewardCategory" aria-invalid={!!creation.errors.rewardCategory} value={rewardCategory} onChange={e=>setRewardCategory(e.target.value)} maxLength={64}/>{fieldError('rewardCategory',creation.errors.rewardCategory)}</label>}</div><label>{releaseLabel}<input aria-label={releaseLabel} aria-describedby="queue-error-cap" aria-invalid={!!creation.errors.cap} value={cap} onChange={e=>setCap(e.target.value)} inputMode={rewardKind==='bch'?'decimal':'numeric'}/>{fieldError('cap',creation.errors.cap)}{releaseRange&&releaseRange!==creation.errors.cap&&<small>{releaseRange}</small>}</label><label>Release interval (minutes)<input type="number" min={minimumMinutes(activeNetwork)} step={minimumMinutes(activeNetwork)} aria-label="Release interval (minutes)" aria-describedby="queue-error-interval" aria-invalid={!!creation.errors.interval} value={interval} onChange={e=>setReleaseInterval(e.target.value)}/>{fieldError('interval',creation.errors.interval)}</label><label>Number of releases<input type="number" min="1" max="1000" aria-label="Number of releases" aria-describedby="queue-error-releases" aria-invalid={!!creation.errors.releases} value={releases} onChange={e=>setReleases(e.target.value)}/>{fieldError('releases',creation.errors.releases)}</label><label>Schedule starts (local time)<input type="datetime-local" step="1" aria-label="Schedule starts (local time)" aria-describedby="queue-error-epoch" aria-invalid={!!creation.errors.epoch} value={epoch} onChange={e=>setEpoch(e.target.value)}/>{fieldError('epoch',creation.errors.epoch)}</label></div>{creationPreview&&<dl><dt>Total reward reserve</dt><dd>{displayAsset(creationPreview.rewardCategory,creationPreview.cap*BigInt(creationPreview.releases))}</dd><dt>Schedule duration</dt><dd>{formatDuration(creationPreview.interval*creationPreview.releases)}</dd><dt>Final scheduled release (local time)</dt><dd>{localTimestamp(creationPreview.epoch+creationPreview.interval*creationPreview.releases)}</dd></dl>}<p>Transactions: {review?.quote?.transactions??'calculated before approval'} · Wallet approvals: {review?.quote?.approvals??'calculated before approval'}</p><p>Estimated network fee: {review?.intent.kind==='create'?(review.quote?.totalFee??review.plan.fee)+' sats':'calculated from wallet inputs before approval'}</p>{review?.intent.kind==='create'&&<p>Total wallet BCH committed, including fee: {review.quote?.walletDebit??review.walletDebit} sats</p>}</fieldset>{actionFeedback}{!creationPreview&&<p>Correct the highlighted fields to create the vault.</p>}<button type="submit" disabled={!canRequest||busy||!creationPreview||continuingSubmission}>Create Vault</button></form>
 {(busy||creations.length>0||messageRoute.current===route&&message)&&<section className="panel" aria-label="Vault creation status"><h2>Vault creation status</h2><div role="status">{messageRoute.current===route&&message&&<p>{message}</p>}</div>{creations.length>0&&<>{discoveryControls}{creations.map(creationStatus)}</>}</section>}
 {recoveryPanel}</>:myOffers?ownerSection:selectedId?<>
  <a href="#/v3/offers">← All vaults</a><h1>Vault {selectedId.slice(0,12)}</h1>{creations.filter(o=>o.txid===selectedId).map(creationStatus)}{!selectedConfig?<p>Finding this vault in public discovery… {catalogError}</p>:<>
   <div className="queue-vault-layout"><section className="panel queue-vault-details" aria-label="Vault details"><h2>Vault details</h2><div className="queue-vault-summary-grid"><div className="queue-vault-data"><p><span>{publicIds.has(selectedId)?'Published configuration':isPublic(selectedId)?'Live public listing':'Saved configuration'}</span>{isPublic(selectedId)&&<> · {confirmationLabel(selectedId)}</>}</p><dl className="terms"><div><dt>Staking asset</dt><dd>{displayAsset(selectedConfig.parameters.stakingCategory)}</dd></div><div><dt>Reward asset</dt><dd>{selectedConfig.parameters.rewardCategory===ZERO?'BCH':tokenIdentity(selectedConfig.parameters.rewardCategory,tokenMetadata(selectedConfig.parameters.rewardCategory))}</dd></div><div><dt>Total max reward</dt><dd>{displayAsset(selectedConfig.parameters.rewardCategory,selectedConfig.parameters.cap*BigInt(selectedConfig.parameters.releases))}</dd></div><div><dt>Reward per release</dt><dd>{displayAsset(selectedConfig.parameters.rewardCategory,selectedConfig.parameters.cap)}</dd></div><div><dt>Release interval</dt><dd>{formatDuration(selectedConfig.parameters.interval)}</dd></div><div><dt>Scheduled releases</dt><dd>{selectedConfig.parameters.releases}</dd></div><div><dt>Starts (local time)</dt><dd>{localTimestamp(selectedConfig.parameters.epoch)}</dd></div></dl><p role="status">{selectedError?`${selectedError}. ${snapshot?'Showing the last reported queue and reserve.':'Live queue and reserve are unavailable.'}`:snapshot?'Provider-reported blockchain state · provisional':'Loading live queue and reserve…'}</p>
   {selectedError&&<button type="button" disabled={retrying} onClick={()=>retryVerification(version=>version+1)}>Retry verification</button>}
   {snapshot&&<dl className="terms"><div><dt>Remaining reserve</dt><dd>{displayAsset(selectedConfig.parameters.rewardCategory,snapshot.state.reserve)}</dd></div></dl>}
   {snapshot&&<div className="queue-claim" role="group" aria-label="Claim reward"><p>Winning reward: {head?displayAsset(selectedConfig.parameters.rewardCategory,head.reward):'none'}</p><p>Caller pays the fee. The reward goes to the winning offer.</p>{review?.intent.kind==='claim'&&<p>Estimated network fee: {review.plan.fee} sats</p>}<button type="button" disabled={!head||!canRequest||busy||!!selectedError||headStatus===undefined||headStatus==='awaiting-release'} title={!head?'No offers waiting':headStatus==='awaiting-release'?'The highest-ranked offer is waiting for scheduled rewards.':headStatus==='never-funded'?'The head cannot be funded by the remaining reserve; this action returns its stake.':undefined} onClick={()=>{if(head)void prepare({kind:'claim',config:selectedConfig,expectedHead:head.id});}}>{head&&head.reward>snapshot.state.reserve?'Return unfundable head':'Claim reward'}</button></div>}</div>{snapshot&&<QueueReleaseSchedule rewardAmount={amount=>displayAsset(selectedConfig.parameters.rewardCategory,amount)} parameters={selectedConfig.parameters} reserve={snapshot.state.reserve} mtp={snapshot.mtp} reportedAt={reportedAt} now={now} available={!selectedError}/>}</div></section>
   <form className="form-panel queue-offer-panel" noValidate onSubmit={e=>{e.preventDefault();if(snapshot&&!selectedError&&terms&&!continuingSubmission)void prepare({kind:'insert',config:selectedConfig,terms});}}><h2>Make an Offer</h2><p>Priority Score = (Stake Amount × Lock Duration) / Requested Reward</p><div className="form-grid"><label>Stake amount ({displayAsset(selectedConfig.parameters.stakingCategory)})<input inputMode={selectedConfig.parameters.stakingCategory===ZERO?'decimal':'numeric'} aria-label="Stake amount" aria-describedby="queue-error-stake" aria-invalid={!!offer.errors.stake} value={stake} onChange={e=>setStake(e.target.value)}/>{fieldError('stake',offer.errors.stake)}</label><label className="queue-lock-duration">Lock duration (time units)<input type="number" min="1" max="65535" aria-label="Lock duration (time units)" aria-describedby="queue-lock-conversion queue-error-duration" aria-invalid={!!offer.errors.duration} value={duration} onChange={e=>setDuration(e.target.value)}/>{fieldError('duration',offer.errors.duration)}<small id="queue-lock-conversion">1 time unit = {STAKING_UNIT_SECONDS} second</small>{offer.lockSeconds!==undefined&&<small aria-live="polite">{formatDuration(offer.lockSeconds)}</small>}</label><label>Requested reward ({displayAsset(selectedConfig.parameters.rewardCategory)})<input inputMode={selectedConfig.parameters.rewardCategory===ZERO?'decimal':'numeric'} aria-label="Requested reward" aria-describedby="queue-error-reward queue-priority-preview" aria-invalid={!!offer.errors.reward} value={reward} onChange={e=>{const value=e.target.value;setRewardDrafts(old=>({...old,[id(selectedConfig)]:value}));}}/>{fieldError('reward',offer.errors.reward)}<small id="queue-priority-preview" aria-live="polite">Priority Score: {offer.priorityTerms?showPriority(offer.priorityTerms,selectedConfig):'—'}</small></label></div><p>Transactions: 1 · Wallet approvals: 1</p><p>Estimated network fee: {review?.intent.kind==='insert'?review.plan.fee+' sats':'calculated from wallet inputs before approval'}</p>{review?.intent.kind==='insert'&&<p>{review.intent.terms&&<>Stake: {displayAsset(review.intent.config.parameters.stakingCategory,review.intent.terms.stake)} · Requested reward: {displayAsset(review.intent.config.parameters.rewardCategory,review.intent.terms.reward)} · </>}Total wallet BCH committed, including fee: {review.walletDebit} sats</p>}{termsError&&<p>Correct the highlighted fields to make an offer.</p>}{actionFeedback}<button disabled={!snapshot||!canRequest||busy||!terms||!!selectedError||continuingSubmission} type="submit">Make an Offer</button></form>

   <section className="panel queue-queue-panel" aria-label="Queue"><h2>Queue</h2>
   {snapshot?<p>Provider-reported state · provisional · {snapshot.ordered.length} waiting{now-reportedAt>60000||selectedError?' · Stale':null}</p>:<p>{selectedError?'Live queue unavailable.':'Loading queue…'}</p>}
   {(snapshot||pendingQueue?.size)?<div className="table-scroll"><table className="queue-ranking-table"><caption className="sr-only">Ranked queue</caption><thead><tr><th>Rank</th><th>Priority Score</th><th>Reward</th><th>Stake</th><th>Lock duration</th></tr></thead><tbody>{[
    ...(snapshot?.ordered??[]).map((terms,n)=>({offerId:terms.id,terms,rank:n+1})),
    ...[...(pendingQueue??[])].map(([offerId,terms])=>({offerId,terms,rank:undefined})),
   ].map(({offerId,terms,rank})=>{
    const highlighted=highlight?.kind==='offer'&&highlight.vaultId===selectedId&&highlight.offerId===offerId;
    return <tr key={offerId} id={'offer-row-'+offerId} tabIndex={highlighted?-1:undefined} className={highlighted?'queue-row-highlight':undefined}>
     <td>{rank??<>Pending<small>Awaiting provider update</small></>}</td><td>{showPriority(terms,selectedConfig)}</td><td>{displayAsset(selectedConfig.parameters.rewardCategory,terms.reward)}</td><td>{displayAsset(selectedConfig.parameters.stakingCategory,terms.stake)}</td><td>{terms.duration/STAKING_UNIT_SECONDS} time {terms.duration===STAKING_UNIT_SECONDS?'unit':'units'}<small>{formatDuration(terms.duration)}</small></td>
    </tr>;
   })}</tbody></table></div>:null}
   {snapshot&&!snapshot.ordered.length&&!pendingQueue?.size&&<p>No offers waiting.</p>}</section>{ownerSection}</div>
  </>}
 </>:<section className="v3-known"><h1>Known vaults</h1>{discoveryControls}
 <QueueCatalogUpdated network={activeNetwork} vaultIds={catalogIds} now={now}/>
 <table className="marketplace-table queue-marketplace"><thead><tr>{queueCatalogColumns.map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
 <tbody>{catalogPage.map((c,n)=>{
  const highlighted=highlight?.kind==='vault'&&highlight.vaultId===id(c);
  return <tr key={id(c)} id={'vault-row-'+id(c)} tabIndex={highlighted?-1:undefined} className={highlighted?'queue-row-highlight':undefined}>
   <td><a className="marketplace-link" aria-label={'Vault '+(page*20+n+1)} href={'#/v3/vault/'+id(c)}>{page*20+n+1}</a></td>
   <QueueRewardCells network={activeNetwork} vaultId={id(c)} category={c.parameters.rewardCategory} metadata={tokenMetadata(c.parameters.rewardCategory)} now={now}/>
   <td data-label={queueCatalogColumns[4]}>{displayAsset(c.parameters.stakingCategory)}
    {isProvisional(id(c))&&<small className="queue-vault-confirmation">{unconfirmedVaultLabel}</small>}
   </td>
   <QueueCountCell network={activeNetwork} vaultId={id(c)} now={now}/>
  </tr>;
 })}</tbody></table>{ready&&!catalogVaults.length&&<p>No linked-list vaults have been discovered yet.</p>}<div><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button disabled={(page+1)*20>=catalogVaults.length&&!pages.length} onClick={()=>{if((page+1)*20>=catalogVaults.length&&pages[0])void discover(pages[0]).then(loaded=>{if(loaded)setPage(p=>p+1);});else setPage(p=>p+1);}}>Next</button></div></section>}
 {!creating&&!myOffers&&!selectedId&&message&&messageRoute.current===route&&<p role="status">{message}</p>}
 {!!recoveryOps.length&&<details ref={recoveryDetails} className="advanced"><summary>Transaction recovery ({recoveryOps.filter(o=>!['confirmed','discarded'].includes(o.stage)).length})</summary>{recoveryOps.filter(o=>o.stage!=='discarded').map(o=><article key={o.id} id={'queue-operation-'+o.id} tabIndex={-1}><p>{o.intent.kind==='recover'?'Old request resolution':o.intent.kind==='create'&&['seed-funding','queue-funding'].includes(o.step)?'Old vault request':o.intent.kind} · {o.step} · {o.supersededBy&&o.reservationResolution==='conflict'?'resolved':o.stage}{o.signing==='uncertain'||o.signing==='requested'?' · Signing status unknown':''} · {o.txid}</p>{o.intent.kind==='create'&&o.intent.parameters&&<p>Reward reserve: {displayAsset(o.intent.parameters.rewardCategory,o.intent.parameters.cap*BigInt(o.intent.parameters.releases))}</p>}{o.intent.kind==='insert'&&o.intent.terms&&<p>Stake: {displayAsset(o.intent.config.parameters.stakingCategory,o.intent.terms.stake)} · Requested reward: {displayAsset(o.intent.config.parameters.rewardCategory,o.intent.terms.reward)}</p>}{o.error&&<details><summary>Inspection details</summary><p>{o.error}</p></details>}{o.raw&&['seed-funding','queue-funding'].includes(o.step)&&!o.supersededBy&&<button type="button" disabled={busy||!canRequest} onClick={()=>void prepare({kind:'recover',operationId:o.id})}>Resolve old request</button>}<button disabled={busy||!canRequest} onClick={()=>void act({operation:'resume',id:o.id})}>Inspect / resume</button>{o.raw&&o.stage==='signed'&&!needsInspection(o)&&['action','wallet-preparation','wallet-recovery'].includes(o.step)&&<button disabled={busy||!canRequest} onClick={()=>void act({operation:'resume',id:o.id,retry:true})}>Retry identical transaction</button>}{!o.raw&&['unsigned','rejected'].includes(o.signing)&&<button disabled={busy} onClick={()=>void queueCall({operation:'discard',id:o.id}).then(operations).catch(e=>setMessage(String(e)))}>Discard unsigned request</button>}</article>)}</details>}
 </div>;
}
