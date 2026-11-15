import type { SettlementStatus as Status } from '../../src/browser-keeper';
const labels:Record<Status['phase'],string>={waiting:'Waiting for the next period','activation-required':'Activation required','settlement-required':'Settlement required',broadcasting:'Broadcasting',pending:'Pending confirmation',confirmed:'Confirmed',retrying:'Failed or retrying',blocked:'Blocked: safe fee funding unavailable',complete:'All periods processed'};
export default function SettlementStatus({status,onProcess,disabled,unavailable=false}:{status?:Status;onProcess:()=>void;disabled:boolean;unavailable?:boolean}) {
 return <section className="panel" aria-label="Period settlement"><h2>Period settlement</h2>
  <p role="status" data-testid="settlement-status"><strong>{status?labels[status.phase]:'Waiting for verified state'}</strong>{status&&<> · {status.message}</>}</p>
  <p>{unavailable?'Chipnet period processing is temporarily unavailable pending consensus/provider repair. Saved settlement records remain retained.':'Automatic period processing is always enabled in supported browsers after canonical state verification. No wallet connection or approval is needed.'}</p>
  <p>Permissionless activation and settlement need no wallet signature. Each unsponsored transition pays 10,000 satoshis from the vault’s excess BCH; a winning settlement also funds its 2,000-satoshi allocation output. Committed reward reserves stay protected.</p>
  <button type="button" disabled={unavailable||disabled||['broadcasting','pending','complete'].includes(status?.phase??'')} onClick={onProcess}>Process Period</button>
  {status?.txid&&<p>Transaction <code>{status.txid}</code> · {status.phase==='confirmed'?'confirmed on the indexed chain':'confirmation is not implied by broadcast'}</p>}
  {status?.nextRetryAt&&<p>Next reconciliation no earlier than {new Date(status.nextRetryAt).toISOString()}.</p>}
  <p className="muted">Processing pauses while data cannot be verified, the site is closed, the tab is suspended, the device is offline, or public Electrum is unavailable. It resumes after verification succeeds. Guaranteed unattended settlement requires an independently operated keeper; independent browsers may race for the same confirmed outpoints.</p>
 </section>;
}
