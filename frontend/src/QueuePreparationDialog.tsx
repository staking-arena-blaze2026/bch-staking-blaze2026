import {useEffect,useRef} from 'react';
import type {CreationQuote} from '../../src/queue/preparation';
export interface PreparationConfirmation {quote:CreationQuote;completed?:number;spentFees?:string;respond:(proceed:boolean)=>void}
/** Await a visible decision; no financial worker call occurs from the dialog. */
export function confirmPreparation(quote:CreationQuote,signal:AbortSignal,completed=0,spentFees='0'):Promise<boolean>{
 return new Promise(resolve=>{let done=false;const finish=(value:boolean)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);window.dispatchEvent(new Event('arena-preparation-close'));resolve(value);};const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{quote,completed,spentFees,respond:finish}}));});
}
export function QueuePreparationDialog({request}:{request:PreparationConfirmation}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 const completed=request.completed??0,paid=BigInt(request.spentFees??'0'),q=request.quote,n=q.transactions-1,extra=q.preparationFees.reduce((sum,s)=>sum+BigInt(s),0n);
 return <dialog ref={ref} className="wallet-dialog" aria-labelledby="preparation-heading" onCancel={e=>{e.preventDefault();request.respond(false);}}>
  <h2 id="preparation-heading">{n?'Additional wallet '+(n===1?'approval':'approvals')+' needed':'Review updated creation costs'}</h2>
  {completed>0&&<p>{completed} wallet approvals have already completed. The estimates below include {paid.toString()} satoshis in fees already paid.</p>}
  {n>0&&<><p>Your wallet needs {n===1?'one additional suitable transaction output':'two suitable transaction outputs from separate transactions'} to create the vault and its queue.</p><p>Staking Arena can prepare this automatically with {n} {n===1?'transaction sending':'transactions sending'} BCH back to your own wallet.</p><ul><li>Vault creation requires <strong>{completed?`${q.approvals} remaining wallet approvals (${completed+q.approvals} in total)`:`${q.approvals} wallet approvals instead of 1`}</strong>.</li><li>{n===1?'One approval prepares your wallet.':`${n} approvals prepare your wallet.`} The final approval creates your vault.</li><li>The extra {n===1?'transaction incurs':'transactions incur'} additional network fees.</li><li>The BCH sent back to your wallet remains yours. The self-send amount is not a fee.</li></ul></>}
  <dl><dt>Expected blockchain transactions</dt><dd>{q.transactions+completed}</dd><dt>Expected wallet approvals</dt><dd>{q.approvals+completed}</dd><dt>Estimated additional fees</dt><dd>{extra.toString()} satoshis</dd><dt>Estimated atomic creation fee</dt><dd>{q.creationFee} satoshis</dd><dt>Estimated total network fees</dt><dd>{(BigInt(q.totalFee)+paid).toString()} satoshis</dd><dt>Reward reserve commitment</dt><dd>{q.reserve} {q.rewardCategory==='0'.repeat(64)?'satoshis':'token units (category '+q.rewardCategory+')'}</dd><dt>Expected total wallet BCH debit, including fees and covenant funding</dt><dd>{(BigInt(q.walletDebit)+paid).toString()} satoshis</dd></dl>
  <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>Continue with {q.approvals} {completed?'remaining ':''}{q.approvals===1?'approval':'approvals'}</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
 </dialog>;
}
