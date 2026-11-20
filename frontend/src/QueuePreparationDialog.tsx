import {categoryAsset} from './assetAmounts';
import {useAssetAmounts} from './useAssetAmounts';
import {activeNetwork} from './activeNetwork';
import {useEffect,useRef} from 'react';
import type {CreationQuote} from '../../src/queue/preparation';
export interface ActionCosts {fee:string;walletDebit:string}
interface ChangedCosts {action:'insert'|'claim';previous:ActionCosts;updated:ActionCosts}
export interface PreparationConfirmation {quote:CreationQuote|ChangedCosts;completed?:number;spentFees?:string;respond:(proceed:boolean)=>void}
/** Await a visible decision; no financial worker call occurs from the dialog. */
export function confirmPreparation(quote:PreparationConfirmation['quote'],signal:AbortSignal,completed=0,spentFees='0'):Promise<boolean>{
 return new Promise(resolve=>{let done=false;const finish=(value:boolean)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);window.dispatchEvent(new Event('arena-preparation-close'));resolve(value);};const abort=()=>finish(false);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{quote,completed,spentFees,respond:finish}}));});
}
export function QueuePreparationDialog({request}:{request:PreparationConfirmation}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();},[]);
 const q=request.quote;
 const reserveAsset='rewardCategory' in q?categoryAsset(q.rewardCategory):undefined;
 const {assetAmount}=useAssetAmounts(activeNetwork,[reserveAsset]);
 if('action' in q){
  const name=q.action==='insert'?'offer':'claim';
  const debit=(value:string)=>BigInt(value)<0n?(-BigInt(value)).toString()+' sats received':value+' sats spent';
  return <dialog ref={ref} className="wallet-dialog" aria-labelledby="preparation-heading" onCancel={e=>{e.preventDefault();request.respond(false);}}>
   <h2 id="preparation-heading">Review updated {name} costs</h2>
   <table><thead><tr><th scope="col">Cost</th><th scope="col">Previous</th><th scope="col">Updated</th></tr></thead>
    <tbody><tr><th scope="row">Network fee</th><td>{q.previous.fee} sats</td><td>{q.updated.fee} sats</td></tr>
    <tr><th scope="row">Net wallet BCH, including fee</th><td>{debit(q.previous.walletDebit)}</td><td>{debit(q.updated.walletDebit)}</td></tr></tbody></table>
   <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>Continue with updated {name}</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
  </dialog>;
 }
 const completed=request.completed??0,paid=BigInt(request.spentFees??'0'),n=q.transactions-1,extra=q.preparationFees.reduce((sum,s)=>sum+BigInt(s),0n);
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
  <h2 id="preparation-heading">{n?'Additional wallet '+(n===1?'approval':'approvals')+' needed':'Review vault creation costs'}</h2>
  <p>These costs are estimates. Continuing checks the selected funds before wallet approval.</p>
  {completed>0&&<p>{completed} wallet approvals have already completed. The estimates below include {paid.toString()} satoshis in fees already paid.</p>}
  {n>0&&<><p>Your wallet needs {n===1?'one additional suitable transaction output':'two suitable transaction outputs from separate transactions'} to create the vault and its queue.</p><p>Staking Arena can prepare this automatically with {n} {n===1?'transaction sending':'transactions sending'} BCH back to your own wallet.</p><ul><li>Vault creation requires <strong>{completed?`${q.approvals} remaining wallet approvals (${completed+q.approvals} in total)`:`${q.approvals} wallet approvals instead of 1`}</strong>.</li><li>{n===1?'One approval prepares your wallet.':`${n} approvals prepare your wallet.`} The final approval creates your vault.</li><li>The extra {n===1?'transaction incurs':'transactions incur'} additional network fees.</li><li>The BCH sent back to your wallet remains yours. The self-send amount is not a fee.</li></ul></>}
  <dl><dt>Expected blockchain transactions</dt><dd>{q.transactions+completed}</dd><dt>Expected wallet approvals</dt><dd>{q.approvals+completed}</dd><dt>Estimated additional fees</dt><dd>{extra.toString()} satoshis</dd><dt>Estimated atomic creation fee</dt><dd>{q.creationFee} satoshis</dd><dt>Estimated total network fees</dt><dd>{(BigInt(q.totalFee)+paid).toString()} satoshis</dd><dt>Reward reserve commitment</dt><dd>{assetAmount(categoryAsset(q.rewardCategory),BigInt(q.reserve))}</dd><dt>Expected total wallet BCH debit, including fees and covenant funding</dt><dd>{(BigInt(q.walletDebit)+paid).toString()} satoshis</dd></dl>
  <div className="wallet-dialog-actions"><button onClick={()=>request.respond(true)}>Continue with {q.approvals} {completed?'remaining ':''}{q.approvals===1?'approval':'approvals'}</button><button onClick={()=>request.respond(false)}>Cancel</button></div>
 </dialog>;
}
