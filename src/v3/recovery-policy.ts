import type {Operation} from './wallet.js';
import {legacyExplicitRefusal} from './funding-report.js';
/** Missing signatures are not proof that an approval never escaped. */
export function canDiscardUnsigned(op:Operation){
 return op.step!=='complete'&&op.stage==='review'&&!op.raw&&!op.txid&&!op.fundingRaw&&!op.childRaw&&!op.funding&&!op.acceptedAt&&
  (op.signing==='unsigned'||op.signing==='rejected'||legacyExplicitRefusal(op));
}
export function blocksVault(op:Operation){return op.step!=='complete'&&!canDiscardUnsigned(op);}
