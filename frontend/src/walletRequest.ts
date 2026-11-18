import {releaseCount} from '../../src/v3/model';
import type {WalletTransactions} from './walletTransactions';

export type WalletRequestCheck=(()=>void)&{readonly startedAt?:number};
export const WALLET_REQUEST_MS = 90_000;
const reviewAgain = () => Error('Wallet request changed. Review the current terms and continue again.');

/** Memory-only user intent. No journal, signing request or transaction exists while waiting.
 * The returned check is also enforced at the live client's approval boundary.
 */
export async function restoreWalletRequest(
  read:()=>WalletTransactions|null,
  unchanged:()=>boolean,
  signal:AbortSignal,
  waiting:()=>void,
):Promise<{wallet:WalletTransactions;check:WalletRequestCheck}> {
  const started=performance.now();
  const initial=read(),pairing=initial?.pairing?.();
  if(!pairing?.paired)throw Error('Connect Wallet to continue');
  const deadline=Date.now()+WALLET_REQUEST_MS,elapsedDeadline=performance.now()+WALLET_REQUEST_MS;
  const check=()=>{
    const current=read()?.pairing?.();
    if(signal.aborted || !unchanged() || !current?.paired || current.generation!==pairing.generation || current.identity!==pairing.identity || current.network!==pairing.network)throw reviewAgain();
  };
  if(!pairing.live){waiting();initial?.restore?.();}
  for(;;){
    check();
    const wallet=read(),current=wallet?.pairing?.();
    if(current?.live){
      const availability=wallet?.v3Availability?.();
      if(!wallet?.v3 || availability?.available===false)throw Error(availability?.reason ?? 'A compatible live wallet is required. Review and continue again.');
      // Restoration is complete. The intent has no elapsed-time deadline; live
      // input/policy authorization is obtained separately at each signing boundary.
      const liveCheck=Object.assign(()=>{check();if(!read()?.pairing?.().live)throw reviewAgain();},{startedAt:started});
      window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{stage:'wallet-restoration',milliseconds:performance.now()-started}}));
      return {wallet,check:liveCheck};
    }
    if(Date.now()>=deadline || performance.now()>=elapsedDeadline)throw Error('Wallet connection timed out. Open Cashonize and continue again.');
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,100);
      signal.addEventListener('abort',done,{once:true});
    });
  }
}

/** Relevant offer state, including the source outpoint and newly released rewards.
 * A new block alone does not change offer terms; changed spendable state does.
 */
export function offerRequestState(snapshot:import('../../src/v3/indexer').Snapshot) {
  return JSON.stringify({state:Array.from(snapshot.instance.state),inputs:snapshot.instance.inputs,pending:snapshot.pending,
    released:releaseCount(snapshot.config,snapshot.clock.mtp-1)},(_,v)=>typeof v==='bigint'?v.toString():v);
}
