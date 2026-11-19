import {useEffect,useRef} from 'react';
import type {CreationQuote} from '../../src/queue/preparation';
export interface PreparationConfirmation {quote:CreationQuote;completed?:number;spentFees?:string;offline?:boolean;respond:(proceed:boolean)=>void}
/** Await a visible decision; no financial worker call occurs from the dialog. */
export function confirmPreparation(quote:CreationQuote,signal:AbortSignal,completed=0,spentFees='0',offline=false):Promise<boolean>{
 return new Promise(resolve=>{let done=false;const finish=(value:boolean)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);window.dispatchEvent(new Event('arena-preparation-close'));resolve(value);};const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{quote,completed,spentFees,offline,respond:finish}}));});
}
export function QueuePreparationDialog({request}:{request:PreparationConfirmation}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 const completed=request.completed??0,paid=BigInt(request.spentFees??'0'),q=request.quote,n=q.transactions-1,extra=q.preparationFees.reduce((sum,s)=>sum+BigInt(s),0n);
 if(q.recovery)return <dialog ref={ref} className="wallet-dialog" aria-labelledby="preparation-heading" onCancel={e=>{e.preventDefault();request.respond(false);}}>
  <h2 id="preparation-heading">Resolve old signed request</h2>
  <p>This resolves the old request that reserves {q.recovery.reservedBch} satoshis. It does not create your new vault.</p>
  <p>Approve one transaction sending BCH back to your own wallet. Only the network fee leaves your wallet. Once confirmed, this invalidates the old signed spend and releases its wallet-only reservations.</p>
  <dl><dt>BCH returned to your wallet</dt><dd>{q.recovery.returnedBch} satoshis</dd><dt>Network fee</dt><dd>{q.totalFee} satoshis</dd><dt>Wallet approvals</dt><dd>1</dd></dl>
  <p>Wait for confirmation, then continue Create Vault. Its approvals and fees will be quoted separately. Old signed bytes and history are retained.</p>
  <details><summary>Old request details</summary><p>Request: {q.recovery.operationId}</p><p>Signed transaction: {q.recovery.transactionId}</p></details>
  <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>Resolve with 1 wallet approval</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
 </dialog>;
 return <dialog ref={ref} className="wallet-dialog" aria-labelledby="preparation-heading" onCancel={e=>{e.preventDefault();request.respond(false);}}>
  <h2 id="preparation-heading">{request.offline?'Review vault creation estimate':n?'Additional wallet '+(n===1?'approval':'approvals')+' needed':'Review updated creation costs'}</h2>
  {request.offline&&<p>Reopen Cashonize after accepting to continue. Funding and network fees may change before signing. You’ll review any change to the plan before Cashonize requests approval.</p>}
  {completed>0&&<p>{completed} wallet approvals have already completed. The estimates below include {paid.toString()} satoshis in fees already paid.</p>}
  {n>0&&<><p>With the funding found in the checked wallet addresses, this plan uses {n===1?'one additional suitable transaction output':'two suitable transaction outputs from separate transactions'} to create the vault and its queue.</p>{completed===0&&<p>The search covers the first 40 indices on each supported wallet path and matching addresses from earlier signing records.</p>}<p>Staking Arena can prepare this automatically with {n} {n===1?'transaction sending':'transactions sending'} BCH back to your own wallet.</p><ul><li>Vault creation requires <strong>{completed?`${q.approvals} remaining wallet approvals (${completed+q.approvals} in total)`:`${q.approvals} wallet approvals instead of 1`}</strong>.</li><li>{n===1?'One approval prepares your wallet.':`${n} approvals prepare your wallet.`} The final approval creates your vault.</li><li>The extra {n===1?'transaction incurs':'transactions incur'} additional network fees.</li><li>The BCH sent back to your wallet remains yours. The self-send amount is not a fee.</li></ul></>}
  <dl><dt>Expected blockchain transactions</dt><dd>{q.transactions+completed}</dd><dt>Expected wallet approvals</dt><dd>{q.approvals+completed}</dd><dt>Estimated preparation fees</dt><dd>{extra.toString()} satoshis</dd><dt>Estimated atomic creation fee</dt><dd>{q.creationFee} satoshis</dd><dt>Estimated total network fees</dt><dd>{(BigInt(q.totalFee)+paid).toString()} satoshis</dd><dt>Reward reserve commitment</dt><dd>{q.reserve} {q.rewardCategory==='0'.repeat(64)?'satoshis':'token units (category '+q.rewardCategory+')'}</dd><dt>Expected total wallet BCH debit, including fees and covenant funding</dt><dd>{(BigInt(q.walletDebit)+paid).toString()} satoshis</dd></dl>
  <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>{request.offline?'Accept estimate and reconnect':`Continue with ${q.approvals} ${completed?'remaining ':''}${q.approvals===1?'approval':'approvals'}`}</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
 </dialog>;
}
