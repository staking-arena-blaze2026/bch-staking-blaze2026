import {useCallback,useEffect,useRef,useState} from 'react';
import {useWalletTransactions} from './walletTransactions';
import type {Operation} from '../../src/v2/wallet';
import {useAssetAmounts} from './useAssetAmounts';
import {saveV2Config,configFromOperation} from './GeneralizedVaults';
const activeKey='arena-v2-active-creation';
const encode=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
export function useV2Creation(){
 const wallet=useWalletTransactions(),current=useRef(wallet);current.current=wallet;
 const [operations,setOperations]=useState<Operation[]>([]),[busy,setBusy]=useState(false),[checkingStatus,setCheckingStatus]=useState(false),[loaded,setLoaded]=useState(false),[message,setMessage]=useState('');
 const working=useRef(false),checking=useRef(false),creating=useRef(false),opening=useRef(false);
 const remember=(id:string)=>{localStorage.setItem(activeKey,id);};
 const update=(op:Operation)=>setOperations(old=>[op,...old.filter(v=>v.id!==op.id)]);
 async function finish(op:Operation){
  if(opening.current||op.kind!=='create'||op.step!=='complete'||!op.config||localStorage.getItem(activeKey)!==op.id)return;
  const source=wallet;opening.current=true;
  try{
   const verified=await source!.v2!({operation:'sync',config:op.config});
   if(current.current!==source)return;
   saveV2Config(verified.config);localStorage.removeItem(activeKey);
   setMessage('V2 vault confirmed and verified. Opening vault…');location.hash='#/v2/vault/'+verified.config.genesis;
  }finally{opening.current=false;}
 }
 const refresh=useCallback(async()=>{
  if(!wallet?.v2||working.current||checking.current)return;
  const source=wallet;checking.current=true;setCheckingStatus(true);
  try{
   let list:Operation[]=await source.v2!({operation:'list'});
   if(current.current!==source)return;
   setLoaded(true);setOperations(list);
   // Inspection only reconciles/builds unsigned plans. It cannot approve or send anything.
   for(const op of list.filter(o=>o.kind==='create'&&((o.step!=='complete'&&(o.raw||o.funding))||localStorage.getItem(activeKey)===o.id)).sort((a,b)=>Number(b.id===localStorage.getItem(activeKey))-Number(a.id===localStorage.getItem(activeKey))).slice(0,3)){
    const next:Operation=await source.v2!({operation:'inspect',id:op.id});
    if(current.current!==source)return;
    list=list.map(o=>o.id===next.id?next:o);setOperations(list);await finish(next);
   }
  }catch(e){if(current.current===source)setMessage('Status verification unavailable; signed transactions are retained. '+String(e));}
  finally{checking.current=false;setCheckingStatus(false);}
 },[wallet]);
 useEffect(()=>{
  setOperations([]);setLoaded(false);setMessage('');
  const changed=(event:Event)=>{const op=(event as CustomEvent<Operation>).detail;if(op.kind!=='create')return;update(op);if(creating.current)remember(op.id);};
  const progress=(event:Event)=>{if(working.current)setMessage((event as CustomEvent<string>).detail);};
  window.addEventListener('arena-v2-operation',changed);window.addEventListener('arena-wallet-progress',progress);
  void refresh();const timer=setInterval(()=>void refresh(),15000);
  return()=>{clearInterval(timer);window.removeEventListener('arena-v2-operation',changed);window.removeEventListener('arena-wallet-progress',progress);};
 },[refresh]);
 async function work(intent:Record<string,unknown>){
  if(working.current||checking.current)return;
  const source=wallet;if(!source?.v2){setMessage('Connect a chipnet WizardConnect wallet first');return;}
  working.current=true;creating.current=intent.operation==='create';setBusy(true);
  try{
   if(typeof intent.id==='string')remember(intent.id);
   setMessage('Verifying confirmed chipnet funding and transaction plan…');
   const op:Operation=await source.v2(intent);
   if(current.current!==source)return;
   update(op);if(creating.current)remember(op.id);if(intent.operation==='discard'&&localStorage.getItem(activeKey)===op.id)localStorage.removeItem(activeKey);
   setMessage(`${op.step}: ${op.stage}. ${op.txid?'Transaction '+op.txid+'. ':''}${op.error??'Broadcast acceptance is not confirmation.'}`);
   await finish(op);return op;
  }catch(e){if(current.current===source)setMessage(String(e));}
  finally{
   creating.current=false;working.current=false;setBusy(false);
   if(current.current===source)try{const list=await source.v2({operation:'list'});if(current.current===source){setOperations(list);setLoaded(true);}}catch{}
  }
 }
 return {operations,busy:busy||checkingStatus,loaded,message,work,refresh};
}
export type V2CreationFlow=ReturnType<typeof useV2Creation>;
export default function V2CreationRecovery({flow:f}:{flow:V2CreationFlow}){
 const wallet=useWalletTransactions();let connected=false;try{connected=!!wallet?.publicKey();}catch{}
 const ops=f.operations.filter(o=>o.kind==='create');
 const {assetAmount,assetLabel}=useAssetAmounts('chipnet',ops.flatMap(o=>[o.parameters.stakingAsset,o.parameters.rewardAsset]));
 return <section className="panel" aria-label="V2 creation recovery"><h2>V2 creation and recovery</h2><p>Funding needs at least one confirmation before a separate genesis approval. Status polling never signs or rebroadcasts. If interrupted or rejected, continue the saved operation with the original wallet. An uncertain broadcast retains its exact signed bytes; do not start another creation to retry it.</p><button type="button" disabled={f.busy} onClick={()=>void f.refresh()}>Check v2 transaction status</button>{!ops.length&&<p>No saved v2 creations on this browser.</p>}{ops.map(op=>{
 const config=configFromOperation(op),needsApproval=op.stage==='review'&&!op.raw&&!op.txid&&op.step!=='complete';
 return <article key={op.id}><h3>V2 creation · {op.step}</h3><p>Staking: {assetLabel(op.parameters.stakingAsset)}. Reward per period: {assetAmount(op.parameters.rewardAsset,op.parameters.cap)}. Total reserve: {assetAmount(op.parameters.rewardAsset,op.parameters.cap*BigInt(op.parameters.periods))}.</p><p>{op.stage==='pending'?'Pending / Unconfirmed (0-conf)':op.stage==='prepared'?'Signed transaction retained; broadcast or confirmation uncertain':op.stage}{op.error?' · '+op.error:''}</p>{op.funding&&<p>Funding transaction: <code>{op.funding}</code></p>}{op.txid&&<p>Transaction: <code>{op.txid}</code></p>}
 {needsApproval&&<button type="button" disabled={f.busy||!connected} onClick={()=>void f.work({operation:'resume',id:op.id})}>{op.step==='funding'?'Review funding in wallet':'Approve v2 genesis in wallet'}</button>}
 {op.raw&&op.stage==='prepared'&&<button type="button" disabled={f.busy||!connected} onClick={()=>void f.work({operation:'rebroadcast',id:op.id})}>Explicitly retry identical signed transaction</button>}
 {op.fundingRaw&&op.step!=='complete'&&<button type="button" disabled={f.busy||!connected} onClick={()=>void f.work({operation:'rebroadcastFunding',id:op.id})}>Explicitly retry original funding if dropped</button>}
 {!op.raw&&!op.txid&&!op.funding&&op.step!=='complete'&&<button type="button" disabled={f.busy||!connected} onClick={()=>void f.work({operation:'discard',id:op.id})}>Discard unsigned v2 plan</button>}
 {config&&<p><a href={'#/v2/vault/'+config.genesis}>Open created v2 vault{op.step==='complete'?'':' (unconfirmed recovery record)'}</a></p>}
 <details><summary>Save public v2 recovery information</summary><p>Retain this browser's journal and the original wallet. This export contains public terms and signed transactions, never private keys.</p><textarea readOnly rows={8} aria-label="V2 public recovery information" value={encode({id:op.id,parameters:op.parameters,owner:op.owner,step:op.step,stage:op.stage,funding:op.funding,fundingRaw:op.fundingRaw,transaction:op.txid,signedTransaction:op.raw,config:op.config})}/></details></article>;
 })}<p role="status">{f.message}</p></section>;
}
