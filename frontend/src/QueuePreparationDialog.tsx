import {useEffect,useRef} from 'react';
import {hexToBin} from '@bitauth/libauth';
import {walletAddress} from '../../src/transactions-core';
import {activeNetwork} from './activeNetwork';
import type {CreationQuote} from '../../src/queue/preparation';
import type {ActionQuote} from '../../src/queue/wallet';
type Review={quote:CreationQuote;completed?:number;spentFees?:string;offline?:boolean;previous?:CreationQuote}|{action:ActionQuote;previous?:ActionQuote};
export type PreparationConfirmation=Review&{respond:(proceed:boolean)=>void};
function confirmReview(review:Review,signal:AbortSignal):Promise<boolean>{
 return new Promise(resolve=>{let done=false;const finish=(value:boolean)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);window.dispatchEvent(new Event('arena-preparation-close'));resolve(value);};const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{...review,respond:finish}}));});
}
export function confirmPreparation(quote:CreationQuote,signal:AbortSignal,completed=0,spentFees='0',offline=false,previous?:CreationQuote){
 return confirmReview({quote,completed,spentFees,offline,previous},signal);
}
export function confirmAction(action:ActionQuote,signal:AbortSignal,previous?:ActionQuote){
 return confirmReview({action,previous},signal);
}
export function QueuePreparationDialog({request}:{request:PreparationConfirmation}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 if('action' in request){
  const {action:q,previous}=request,units=q.asset==='0'.repeat(64)?'satoshis':'token units (category '+q.asset+')';
  return <dialog ref={ref} className="wallet-dialog" aria-labelledby="preparation-heading" onCancel={e=>{e.preventDefault();request.respond(false);}}>
   <h2 id="preparation-heading">{q.kind==='insert'?'Review updated offer costs':q.returningStake?'Review updated stake return costs':'Review updated claim costs'}</h2>
   <p>The verified transaction uses different inputs or terms. Review it before approving in Cashonize.</p>
   {q.kind==='claim'&&<p>You pay the network fee. {q.returningStake?'The stake goes back to the owner of the unfundable offer.':'The reward goes to the winning offer, which may belong to someone else.'}</p>}
   <dl>
    <dt>Network fee</dt><dd>{q.fee} satoshis{previous&&previous.fee!==q.fee?' (estimated '+previous.fee+')':''}</dd>
    <dt>Wallet BCH debit</dt><dd>{q.walletDebit} satoshis{previous&&previous.walletDebit!==q.walletDebit?' (estimated '+previous.walletDebit+')':''}</dd>
    <dt>{q.kind==='insert'?'Stake':q.returningStake?'Returned stake':'Winning reward'}</dt><dd>{q.amount} {units}</dd>
    {q.kind==='insert'?<><dt>Queue position</dt><dd>{q.afterOffer?'After offer '+q.afterOffer.slice(0,12):'Head of the queue'}{previous&&previous.afterOffer!==q.afterOffer?' (position changed)':''}</dd></>:<>
     <dt>Offer ID</dt><dd className="hash">{q.offerId}</dd>
     {q.beneficiary&&<><dt>Recipient</dt><dd className="hash">{walletAddress(hexToBin(q.beneficiary),activeNetwork)}{previous?.beneficiary&&previous.beneficiary!==q.beneficiary?' (recipient changed)':''}</dd></>}
    </>}
    <dt>Transactions and wallet approvals</dt><dd>1 each</dd>
   </dl>
   <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>Continue to Cashonize</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
  </dialog>;
 }
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
  {request.offline&&<p>This estimate uses reported funding. Reopen Cashonize after accepting so the app can verify funding and fees with independent providers. You’ll review any material change before Cashonize requests approval.</p>}
  {!request.offline&&request.previous&&<p>The verified plan uses different inputs or terms. The previous estimate showed {request.previous.approvals} wallet {request.previous.approvals===1?'approval':'approvals'}, {request.previous.totalFee} satoshis in network fees and {request.previous.walletDebit} satoshis in total BCH debit.</p>}
  {completed>0&&<p>{completed} wallet approvals have already completed. The estimates below include {paid.toString()} satoshis in fees already paid.</p>}
  {n>0&&<><p>With the funding found in the checked wallet addresses, this plan uses {n===1?'one additional suitable transaction output':'two suitable transaction outputs from separate transactions'} to create the vault and its queue.</p>{completed===0&&<p>The search covers the first 40 indices on each supported wallet path and matching addresses from earlier signing records.</p>}<p>Staking Arena can prepare this automatically with {n} {n===1?'transaction sending':'transactions sending'} BCH back to your own wallet.</p><ul><li>Vault creation requires <strong>{completed?`${q.approvals} remaining wallet approvals (${completed+q.approvals} in total)`:`${q.approvals} wallet approvals instead of 1`}</strong>.</li><li>{n===1?'One approval prepares your wallet.':`${n} approvals prepare your wallet.`} The final approval creates your vault.</li><li>The extra {n===1?'transaction incurs':'transactions incur'} additional network fees.</li><li>The BCH sent back to your wallet remains yours. The self-send amount is not a fee.</li></ul></>}
  <dl><dt>Expected blockchain transactions</dt><dd>{q.transactions+completed}</dd><dt>Expected wallet approvals</dt><dd>{q.approvals+completed}</dd><dt>Estimated preparation fees</dt><dd>{extra.toString()} satoshis</dd><dt>Estimated atomic creation fee</dt><dd>{q.creationFee} satoshis</dd><dt>Estimated total network fees</dt><dd>{(BigInt(q.totalFee)+paid).toString()} satoshis</dd><dt>Reward reserve commitment</dt><dd>{q.reserve} {q.rewardCategory==='0'.repeat(64)?'satoshis':'token units (category '+q.rewardCategory+')'}</dd><dt>Expected total wallet BCH debit, including fees and covenant funding</dt><dd>{(BigInt(q.walletDebit)+paid).toString()} satoshis</dd></dl>
  <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>{request.offline?'Accept estimate and reconnect':`Continue with ${q.approvals} ${completed?'remaining ':''}${q.approvals===1?'approval':'approvals'}`}</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
 </dialog>;
}
