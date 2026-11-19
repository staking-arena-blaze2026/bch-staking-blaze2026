import {activeNetwork,networkLeaving} from './activeNetwork';
import {signWithRefusalEvidence,ExplicitWalletRefusal} from './walletSigning';
import {checkedWalletKey,walletChains} from './walletDerivation';
import {walletDiagnostic} from './usePersistentWallet';
import {v3Call} from './v3Client';
import {queueCall} from './queueClient';
import {confirmPreparation} from './QueuePreparationDialog';
import type {DappConnectionManager} from '@wizardconnect/dapp';
import {binToHex,sha256} from '@bitauth/libauth';
import type {WalletOperation} from '../../src/browser-wallet';
import type {WalletKey} from '../../src/transactions-core';
import {browserConfig} from './browserConfig';
import {wizardWireTransaction,type WalletTransactions} from './walletTransactions';
import {saveLocalVault} from './vaultCatalog';
import type {Operation as V2Operation} from '../../src/v2/wallet';
/** The worker builds/verifies public transactions. Only the live wallet manager ever signs. */
export function browserWalletClient(manager:DappConnectionManager|null,check:()=>void,getRevision:()=>number=()=>0):WalletTransactions {
 walletDiagnostic('Wallet worker started');
 const getManager=()=>{if(!manager)throw Error('Connect a chipnet wallet first');return manager;};
 const worker=new Worker(new URL('./wallet.worker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let counter=0,scanLimit=40,closed=false,v2Approval=false,v3Approval=false;let signing=new AbortController();let startupTimer:ReturnType<typeof setTimeout>|undefined,startupReject:(e:Error)=>void=()=>{};let derived:WalletKey[]|undefined,derivationIdentity="",v3ScanLimit=2;
 const rpc=(method:string,...args:unknown[])=>new Promise<any>((resolve,reject)=>{if(activeNetwork==='mainnet'){reject(Error('Legacy wallet operations require chipnet; use V3 / Atomic V4 on mainnet'));return;}if(closed){reject(Error('Wallet session closed; reconnect and resume from the journal'));return;}const id=++counter;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});
 const startup=new Promise<void>((resolve,reject)=>{startupReject=reject;const timer=startupTimer=setTimeout(()=>reject(Error('Wallet worker startup timeout')),30000);worker.onmessage=event=>{if(event.data?.type==='operation'){window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:event.data.operation}));return;}if(event.data?.type==='progress'){window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:event.data.message}));return;}if(event.data?.type==='ready'){clearTimeout(timer);if(activeNetwork==='mainnet'){resolve();return;}try{void rpc('start',browserConfig()).then(()=>rpc('list')).then((list:WalletOperation[])=>{list.forEach(rememberGenesis);resolve();},reject);}catch(error){reject(error);}return;}const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);event.data.error?task.reject(Error(event.data.error)):task.resolve(event.data.result);};});
 void startup.catch(()=>{});
 worker.onerror=()=>{clearTimeout(startupTimer);startupReject(Error('Wallet worker failed; reconnect and resume'));for(const task of pending.values())task.reject(Error('Wallet worker failed; reload and resume from the journal'));pending.clear();};
 // A transport interruption invalidates all in-flight preparation/approval contexts,
 // including work that completes after the same wallet reconnects. Journals remain intact.
 let authorizationRevision=0;
 const invalidate=()=>{authorizationRevision++; discoveryId='';savedDiscoveryKeys=[];discoveryLoad=undefined;clearTimeout(warmTimer);signing.abort();window.dispatchEvent(new Event('arena-queue-wallet-invalidated'));};
 window.addEventListener('arena-network-leaving',invalidate);
 manager?.on?.('reconnecting',invalidate);
 manager?.on?.('disconnect',invalidate);
 const authorizationCheck=()=>{if(signing.signal.aborted)signing=new AbortController();const revision=authorizationRevision,networkRevision=getRevision();return ()=>{if(closed||networkLeaving)throw Error('Wallet session closed or network changed');check();if(revision!==authorizationRevision || networkRevision!==getRevision())throw Error('Wallet authorization changed; review and retry from the journal');};};
 const keys=(limit=scanLimit)=>{check();const paths=getManager().getSessionPaths(),identity=JSON.stringify(paths);if(identity!==derivationIdentity){derived=[];derivationIdentity=identity;}const result:WalletKey[]=[];let count=0;
 for(let index=0;index<limit;index++)for(const [path,child] of walletChains){if(!getManager().hasPath(child))continue;let key=derived?.find(k=>k.path===path&&k.index===index);if(!key){key=checkedWalletKey(paths,path,index,(c,i)=>getManager().getPubkey(c,i),activeNetwork==='mainnet'?'mainnet':'testnet');(derived??=[]).push(key);count++;}result.push(key);}
 window.dispatchEvent(new CustomEvent('arena-wallet-derivation',{detail:{derived:count,total:derived?.length??0,first:result.find(k=>k.path==='receive'&&k.index===0),paths:paths.map(p=>p.name)}}));return result;};
 let discoveryId='',savedDiscoveryKeys:WalletKey[]=[],discoveryLoad:Promise<void>|undefined,warming=false,warmTimer:ReturnType<typeof setTimeout>|undefined;
 const discoveryLimits=[2,8,16,24,32,40];
 function liveDiscoveryId(){
  check();
  const paths=getManager().getSessionPaths().map(path=>[path.name,path.xpub]).sort(([a],[b])=>a!.localeCompare(b!));
  const id=binToHex(sha256.hash(new TextEncoder().encode(JSON.stringify([activeNetwork,paths]))));
  if(id!==discoveryId){discoveryId=id;savedDiscoveryKeys=[];discoveryLoad=undefined;}
  return id;
 }
 async function queueDescriptors(limit:number,background=false){
  const descriptors=keys(limit),owner=descriptors.find(k=>k.path==='receive'&&k.index===0);
  const saved=await queueCall({operation:'list'});
  check();
  const journal:import('../../src/queue/wallet').Operation[]=Array.isArray(saved)?saved:[];
  const hints:WalletKey[]=[];
  const add=(path:WalletKey['path'],index:number,signer:string)=>{
   if(!walletChains.some(([name,child])=>name===path&&getManager().hasPath(child))||!Number.isSafeInteger(index)||index<0||index>=200||hints.some(k=>k.path===path&&k.index===index))return;
   let key=derived?.find(k=>k.path===path&&k.index===index);
   if(!key){key=checkedWalletKey(getManager().getSessionPaths(),path,index,(c,i)=>getManager().getPubkey(c,i),activeNetwork==='mainnet'?'mainnet':'testnet');(derived??=[]).push(key);}
   if(key.publicKey===signer)hints.push({...key,fundingHint:true});
  };
  for(const key of savedDiscoveryKeys){
   add(key.path,key.index,key.publicKey);
   if(background&&hints.length>=4)break;
  }
  for(const op of journal){
   if(background&&hints.length>=4)break;
   if(op.owner?.publicKey!==owner?.publicKey||op.network&&op.network!==activeNetwork)continue;
   for(const [input,path,index] of op.plan?.inputPaths??[]){
    const signer=op.plan.signers[input];if(signer)add(path,index,signer);
    if(background&&hints.length>=4)break;
   }
  }
  return {descriptors,hints};
 }
 async function warmQueue(batch=0,expand=true){
  if(warming||v3Approval||v2Approval||closed||networkLeaving||document.visibilityState==='hidden')return;
  warming=true;const revision=authorizationRevision;
  try{
   const id=liveDiscoveryId();
   if(batch===0){
    discoveryLoad??=queueCall({operation:'loadDiscovery',discoveryId:id}).then(loaded=>{
     if(id===discoveryId&&revision===authorizationRevision&&Array.isArray(loaded))savedDiscoveryKeys=loaded;
    }).catch(()=>{});
    await discoveryLoad;
    if(revision!==authorizationRevision||closed||networkLeaving)return;
   }
   const {descriptors,hints}=await queueDescriptors(discoveryLimits[batch]!,true);
   if(v3Approval||v2Approval||closed||networkLeaving||revision!==authorizationRevision)return;
   const result=await queueCall({operation:'warmDiscovery',discoveryId:id,refresh:batch===0},mergeDescriptors(hints,descriptors));
   if(!result||id!==discoveryId||closed||revision!==authorizationRevision)return;
   savedDiscoveryKeys=mergeDescriptors(result.funded??[],savedDiscoveryKeys);
   if(result.origins<2&&!v3Approval&&expand&&batch+1<discoveryLimits.length){
    clearTimeout(warmTimer);
    warmTimer=setTimeout(()=>void warmQueue(batch+1),1500);
   }
  }catch{/* The foreground flow independently retries unavailable discovery. */}
  finally{warming=false;}
 }
 function mergeDescriptors(hints:WalletKey[],ordinary:WalletKey[]){
  const result=new Map<string,WalletKey>();
  for(const key of [...hints,...ordinary]){const id=key.path+':'+key.index;if(!result.has(id))result.set(id,key);}
  return [...result.values()];
 }
 function rememberGenesis(op:WalletOperation){if(op.kind==='create'&&op.genesis&&op.pregenesis)saveLocalVault({...op.parameters,genesis:op.genesis},op.pregenesis);}
 async function finish(op:WalletOperation) {
  rememberGenesis(op);
  if(op.step==='complete'&&op.config){const verified=await rpc('importVault',op.config);saveLocalVault(verified.config,verified.category);}
  window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:op}));
  return {txid:op.txid??'',status:op.stage,operation:op};
 }
 function v2Updated(result:V2Operation){if(result?.id)window.dispatchEvent(new CustomEvent('arena-v2-operation',{detail:result}));return result;}
 return {browser:true,warmQueue:(expand=true)=>warmQueue(0,expand),v3Availability(){try{check();const current=getManager();if(typeof current.signTransaction!=='function'||!current.hasPath(0))throw Error('Compatible transaction signing and receive derivation required');return {available:true};}catch(error){return {available:false,reason:manager?String(error):'Connect a compatible WizardConnect/Cashonize wallet using chipnet test funds'};}},async v2(intent){
   const check=authorizationCheck();
   await startup;
   if(['list','sync'].includes(String(intent.operation)))return rpc('v2',intent,[]);
   if(v2Approval)throw Error('A v2 wallet operation is awaiting approval; finish it before continuing');
   if(intent.operation==='inspect')return v2Updated(await rpc('v2',intent,[]));
   v2Approval=true;
   try{
    // Every spending call is checked against the live session. Inspect/list never ask to sign.
    check();const session=JSON.stringify(getManager().getSessionPaths());
    if(typeof getManager().signTransaction!=='function')throw Error('Wallet does not support transaction signing');
    const result=v2Updated(await rpc('v2',intent,intent.operation==='resume'?[]:keys()));
    if(!result?.plan||result.stage!=='review')return result;
    const authorization=await rpc('v2',{operation:'authorize',id:result.id},[]);
    check();if(authorization.owner?.publicKey!==binToHex(getManager().getPubkey(0,0n)??new Uint8Array()))throw Error('Resume with the original v2 wallet owner');
    if(Date.now()-authorization.verifiedAt>10000)throw Error('V2 approval verification became stale; reconcile and retry');
    if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before v2 approval');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Requesting Cashonize approval… '+authorization.plan.label}));
    const signed=await getManager().signTransaction({transaction:wizardWireTransaction(authorization.plan.request),inputPaths:authorization.plan.inputPaths},{signal:signing.signal});
    check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during v2 approval');
    if(signed.error||!signed.signedTransaction)throw Error('V2 signing refused; operation remains recoverable');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Validating the signed v2 transaction and confirmed chipnet inputs before broadcast'}));
    return v2Updated(await rpc('v2',{operation:'submit',id:result.id,raw:signed.signedTransaction},[]));
   }finally{v2Approval=false;}
  },async v3(intent,requestCheck){
   const started=performance.now();let derivationMilliseconds=0;
   const liveCheck=authorizationCheck();
   const check=()=>{liveCheck();requestCheck?.();};
   if(intent.operation==='expandScan'){check();v3ScanLimit=v3ScanLimit<40?40:200;return `Wallet discovery expanded to ${v3ScanLimit} addresses per path. Retry Create Vault. Only needed addresses will be queried.`;}
   if(['list','sync'].includes(String(intent.operation)))return v3Call(intent,[]);
   if(v3Approval)throw Error('A v3 wallet operation is awaiting approval; finish it before continuing');
   if(intent.operation==='inspect')return (await v3Call(intent,[]));
   v3Approval=true;
   try{
    // Every spending call is checked against the live session. Inspect/list never ask to sign.
    check();const session=JSON.stringify(getManager().getSessionPaths());
    if(typeof getManager().signTransaction!=='function')throw Error('Wallet does not support transaction signing');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:intent.operation==='offer'?'Preparing offer…':'Preparing vault…'}));
    let publicKeys:WalletKey[]=[];
    if(intent.operation!=='resume'){
     const derivationStarted=performance.now();publicKeys=keys(v3ScanLimit);derivationMilliseconds=performance.now()-derivationStarted;
     // Existing public journals point to actual previously funded children. Query these
     // before expanding unrelated addresses; bind each hint to this exact live owner.
     let hinted=0;const owner=publicKeys.find(k=>k.path==='receive'&&k.index===0),journal=await v3Call({operation:'list'},[]) as import('../../src/v3/wallet').Operation[];
     const hintDerivationStarted=performance.now();
     for(const op of journal){if(op.owner?.publicKey!==owner?.publicKey||!op.plan)continue;
      for(const [input,path,index] of op.plan.inputPaths){if(!Number.isSafeInteger(index)||index<0||index>=200)continue;const pub=op.plan.signers[input];if(!pub)continue;
       let current=derived?.find(k=>k.path===path&&k.index===index);if(!current){current=checkedWalletKey(getManager().getSessionPaths(),path,index,(c,i)=>getManager().getPubkey(c,i),activeNetwork==='mainnet'?'mainnet':'testnet');(derived??=[]).push(current);hinted++;}if(current.publicKey!==pub)continue;
       const existing=publicKeys.find(k=>k.path===path&&k.index===index);if(existing)existing.fundingHint=true;else publicKeys.push({...current,fundingHint:true});
      }
     }
     window.dispatchEvent(new CustomEvent('arena-wallet-derivation',{detail:{derived:hinted,total:derived?.length??0,first:owner,paths:getManager().getSessionPaths().map(p=>p.name)}}));
     derivationMilliseconds+=performance.now()-hintDerivationStarted;
     window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:intent.operation,stage:'public-key-derivation',milliseconds:derivationMilliseconds}}));
     check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during funding discovery');
    }
    const result=(await v3Call(intent,publicKeys));
    if(!result?.plan||result.stage!=='review')return result;
    const authorization=await v3Call({operation:'authorize',id:result.id},[]);
    if(authorization.plan.request.broadcast!==false)throw Error('V3 wallet broadcasting must remain disabled');
    check();if(authorization.owner?.publicKey!==binToHex(getManager().getPubkey(0,0n)??new Uint8Array()))throw Error('Resume with the original v3 wallet owner');
    if(Date.now()-authorization.verifiedAt>10000)throw Error('V3 approval verification became stale; reconcile and retry');
    if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before v3 approval');
    window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:intent.operation,derivationMilliseconds,untilAuthorizationMilliseconds:performance.now()-started}}));
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Requesting Cashonize approval… '+authorization.plan.label}));
    try{
    const approvalStarted=performance.now();
    const signed=await signWithRefusalEvidence(getManager(),{transaction:wizardWireTransaction(authorization.plan.request),inputPaths:authorization.plan.inputPaths},{signal:signing.signal});
    const signatureReturned=performance.now();
    window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:intent.operation,stage:'cashonize-request-response',milliseconds:signatureReturned-approvalStarted}}));
    if(signed.signedTransaction)await v3Call({operation:result.registrationMode==='atomic'?'retainAtomicSigned':'retainSigned',id:result.id,raw:signed.signedTransaction},[]);
    check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during v3 approval');
    if(!signed.signedTransaction)throw Error('V3 signing status unknown; inputs remain reserved');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Verifying BCH inputs… Checking unconfirmed ancestry…'}));
    const submitted=await v3Call({operation:'submit',id:result.id,raw:signed.signedTransaction},[]);
    window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:intent.operation,stage:'signature-to-feedback',milliseconds:performance.now()-signatureReturned}}));
    return submitted;
    }catch(error){await v3Call({operation:'signingFailed',id:result.id,error:String(error),rejected:error instanceof ExplicitWalletRefusal},[]).catch(()=>{});throw error;}
   }finally{v3Approval=false;}
  },async queue(intent,requestCheck){
   const live=authorizationCheck(),guard=()=>{live();requestCheck?.();};guard();
   if(v3Approval||v2Approval)throw Error('Finish the pending wallet approval first');v3Approval=true;clearTimeout(warmTimer);
   let result:any,signatureRequested=false;
   try{
    let previousSignatureAt:number|undefined;
    const started=requestCheck?.startedAt??performance.now(),session=JSON.stringify(getManager().getSessionPaths());
    const progress=(message:string)=>window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:message}));
    const measure=async<T,>(stage:string,run:()=>Promise<T>)=>{const start=performance.now();try{return await run();}finally{window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{stage,milliseconds:performance.now()-start}}));}};
    const creating=intent.operation==='prepare'&&(intent.intent as {kind?:string})?.kind==='create';
    const shared=creating||intent.operation==='prepare'&&(intent.intent as {kind?:string})?.kind==='insert';
    const scope=shared?liveDiscoveryId():crypto.randomUUID();let descriptors:WalletKey[]=[];
    const limits=intent.operation==='prepare'&&(intent.intent as {kind?:string})?.kind!=='recover'?discoveryLimits:[40];
    const initial=shared?await measure('public-key-derivation',async()=>{await discoveryLoad;guard();return queueDescriptors(2);}):undefined;
    for(const limit of limits){
     guard();progress('Finding available wallet funds — checking '+limit+' addresses per path…');
     descriptors=initial&&limit===2?mergeDescriptors(initial.hints,initial.descriptors):await measure('public-key-derivation',async()=>mergeDescriptors(initial?.hints??[],keys(limit)));
     const request={...intent,discoveryId:scope,...(shared?{atomicOnly:creating&&limit<40,firstBatch:limit===2}:{})};
     try{
      try{result=await queueCall(request,descriptors);}
      catch(error){
       if((error as {details?:{code?:string}})?.details?.code!=='refresh-wallet-discovery')throw error;
       guard();progress('Wallet funds changed. Refreshing the checked addresses…');
       result=await queueCall({...request,firstBatch:true},descriptors);
      }
     }catch(error){
      if(limit===40||(!(error as {details?:{code?:string}})?.details?.code?.includes('funding')&&!/Insufficient|funding is required|funding for|funding propagates|Atomic vault creation needs/i.test(String(error))))throw error;
      continue;
     }
     if(intent.operation!=='prepare'||result?.intent?.kind!=='create'||result.quote?.transactions===1||limit===40)break;
     guard();await queueCall({operation:'discard',id:result.id});
    }
    if(typeof result?.step==='string'&&!['action','wallet-preparation','wallet-recovery'].includes(result.step))return result;
    let approval=(result?.completed??0)+(result?.raw?1:0),total=(result?.completed??0)+(result?.quote?.approvals??1);
    for(;;){
    guard();
    if(result?.raw&&result.step==='wallet-preparation'&&['pending','confirmed'].includes(result.stage)&&!result.error){
     approval=Math.max(approval,(result.completed??0)+1);
     window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Verifying prepared output…'}));
     result=await queueCall({operation:'advance',id:result.id},descriptors);signatureRequested=false;guard();continue;
    }
    if(result?.stage!=='review'||!result.plan)return result;
    if(result.quote&&!result.approved){
     window.dispatchEvent(new CustomEvent('arena-queue-review',{detail:result}));
     progress('Waiting for your confirmation');
     const proceed=await measure('user-confirmation',()=>confirmPreparation(result.quote,signing.signal,approval,result.spentFees??'0'));guard();
     if(!proceed){await queueCall({operation:'discard',id:result.id});result.stage='discarded';throw Error(result.recovery?'Old request resolution cancelled. No new transaction was signed or broadcast.':approval?'Vault creation cancelled after wallet preparation. Completed transactions remain in recovery.':'Vault creation cancelled. No new transaction was signed or broadcast.');}
     result=await queueCall({operation:'confirm',id:result.id});guard();total=approval+result.quote.approvals;
    }
    progress('Checking wallet inputs and current fee policy before approval…');
    let authorized;try{authorized=await measure('signing-authorization',()=>queueCall({operation:'authorize',id:result.id}));}catch(error){
     if(!/Fee policy changed|Blockchain reorganized|Tip changed/.test(String(error)))throw error;
     progress('Blockchain or fees changed. Recalculating the plan for review…');
     result=await queueCall({operation:'resume',id:result.id},descriptors);guard();continue;
    }guard();
    if(authorized.owner.publicKey!==binToHex(getManager().getPubkey(0,0n)??new Uint8Array())||JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before queue approval');
    if(authorized.plan.request.broadcast!==false||Date.now()-authorized.verifiedAt>10000)throw Error('Queue approval requires fresh verified inputs');
    window.dispatchEvent(new CustomEvent('arena-queue-review',{detail:{...result,...authorized}}));
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Requesting Cashonize approval '+(++approval)+' of '+total+' · '+authorized.plan.label}));
    try{await queueCall({operation:'beginSigning',id:result.id});guard();if(Date.now()-authorized.verifiedAt<0||Date.now()-authorized.verifiedAt>10000)throw Error('Queue approval requires fresh verified inputs');if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before queue signing');}catch(error){await queueCall({operation:'signingFailed',id:result.id,rejected:true,notRequested:true}).catch(()=>{});throw error;}
    if(approval===1)window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{stage:'until-first-approval',milliseconds:performance.now()-started}}));
    if(previousSignatureAt!==undefined)window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{stage:'between-approvals',milliseconds:performance.now()-previousSignatureAt}}));
    const signingId=String(result.id);
    let signed;signatureRequested=true;try{signed=await measure('wallet-signing',()=>signWithRefusalEvidence(getManager(),{transaction:wizardWireTransaction(authorized.plan.request),inputPaths:authorized.plan.inputPaths},{signal:signing.signal},async raw=>{
     try{await queueCall({operation:'retain',id:signingId,raw});progress('Late signed response saved. Inspect transaction recovery before continuing.');}
     catch(error){progress('A signed wallet response arrived, but recovery storage failed. Keep this page open and inspect transaction recovery.');throw error;}
    }));}catch(error){await queueCall({operation:'signingFailed',id:result.id,rejected:error instanceof ExplicitWalletRefusal}).catch(()=>{});throw error;}
    previousSignatureAt=performance.now();
    if(!signed.signedTransaction)throw Error('Signing status unknown; check transaction recovery');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Verifying signed transaction…'}));
    await measure('signed-transaction-verification',()=>queueCall({operation:'retain',id:result.id,raw:signed.signedTransaction}));guard();
    if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during queue approval; signed bytes retained');
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Broadcasting the signed transaction…'}));
    result=await measure('transaction-broadcast',()=>queueCall({operation:'submit',id:result.id}));guard();
    if(result.step!=='wallet-preparation')return result;
    }
   }catch(error){
    // Cancellation before any prompt must not strand a purely unsigned funding
    // reservation. The worker independently refuses signed/uncertain discards.
    if(!signatureRequested&&result?.id&&result.stage==='review'&&!result.raw)await queueCall({operation:'discard',id:result.id}).catch(()=>{});
    throw error;
   }finally{v3Approval=false;}
  },publicKey(){check();const key=getManager().getPubkey(0,0n);if(!key)throw Error('Wallet receive key unavailable');return binToHex(key);},async inventory(limit=40){if(![40,200].includes(limit))throw Error("Unsupported scan bound");scanLimit=limit;await startup;return rpc('scan',keys());},async operations(){await startup;const list=await rpc('list') as WalletOperation[];list.forEach(rememberGenesis);return list;},async inspect(id){await startup;const op=await rpc('get',id) as WalletOperation;if(op.step==='complete')await finish(op);return op;},async importVault(config){await startup;const result=await rpc('importVault',config,true);saveLocalVault(result.config,result.category);return result;},async execute(intent){
  const check=authorizationCheck();
  await startup;let op:WalletOperation;
  if(intent.kind==='cancel')return finish(await rpc('cancel',intent.id));
  if(intent.kind==='recover')return finish(await rpc('recover',intent.parameters,intent.pregenesis));
  if(intent.kind==='resume'){const stored=await rpc('get',intent.id) as WalletOperation;if(stored.kind==='create'&&stored.txid&&(stored.stage==='confirmed'||['genesis','complete'].includes(stored.step)))return finish(await rpc('advance',intent.id,[]));}
  const publicKeys=keys(),session=JSON.stringify(getManager().getSessionPaths());
  if(intent.kind==='create')op=await rpc('create',intent.parameters,publicKeys);
  else if(intent.kind==='offer')op=await rpc('offer',intent.config,intent.terms,publicKeys);
  else if(intent.kind==='resume')op=await rpc('advance',intent.id,publicKeys);
  else throw Error('Unsupported browser wallet operation');
  if(op.stage==='review'&&op.plan){
   const authorization=await rpc('authorize',op.id,publicKeys);
   check();if(authorization.deadline!==undefined&&Date.now()/1000>=authorization.deadline)throw Error('Scheduled registration cutoff passed before wallet approval');
   if(Date.now()-authorization.verifiedAt>10000)throw Error('Wallet authorization data became stale; retry verification');
   if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed before approval');
   window.dispatchEvent(new CustomEvent('arena-wallet-operation',{detail:op}));
   window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Awaiting explicit wallet approval for '+op.plan.label}));
   const signed=await getManager().signTransaction({transaction:wizardWireTransaction(op.plan.request),inputPaths:op.plan.inputPaths},{signal:signing.signal});
   check();if(JSON.stringify(getManager().getSessionPaths())!==session)throw Error('Wallet changed during approval');
   if(signed.error||!signed.signedTransaction)throw Error('Wallet rejected signing. The unsigned operation remains resumable.');
   window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Validating signed transaction and checking current chipnet inputs before broadcast'}));
   op=await rpc('submit',op.id,signed.signedTransaction,publicKeys);
  }
  return finish(op);
 },close(){if(closed)return;closed=true;invalidate();window.removeEventListener('arena-network-leaving',invalidate);manager?.off?.('reconnecting',invalidate);manager?.off?.('disconnect',invalidate);walletDiagnostic('Wallet worker stopped; journals preserved');clearTimeout(startupTimer);startupReject(Error('Wallet worker closed'));signing.abort();worker.terminate();for(const t of pending.values())t.reject(Error('Wallet disconnected; operation journal preserved'));pending.clear();}};
}
