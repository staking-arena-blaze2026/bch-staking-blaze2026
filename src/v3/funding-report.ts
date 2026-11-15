import type {WalletCoin,WalletKey} from '../transactions-core.js';
import {walletAddress} from '../transactions-core.js';
import {binToHex,hexToBin} from '@bitauth/libauth';
import type {Operation} from './wallet.js';
export interface FundingReport {
 addressesQueried:number;utxos:number;total:string;confirmed:string;unconfirmed:string;unclassified:string;
 tokenFree:string;eligibleTokenCarriers:string;reserved:string;unsignedReleased:string;unsupported:string;
 ancestryExcluded:string;unsupportedConditions:string;available:string;selectedInputs:number;availableInputs:number;required?:string;
 milliseconds:number;reason:string;verification:'discovered'|'selected-inputs-verified';
 /** Private, memory-only diagnostics; never logged or persisted. */
 queried:{path:WalletKey['path'];index:number;address:string}[];
}
/** Legacy Cashonize onCancel response, before signing or broadcast. This exact
 * journal format came from the old signingFailed handler. Do not generalize to
 * 'failed', 'aborted', unknown outcomes, substring matches or missing status.
 */
export function legacyExplicitRefusal(op:Operation){
 return op.signing===undefined&&op.stage==='review'&&!op.raw&&!op.txid&&!op.fundingRaw&&!op.childRaw&&!op.funding&&op.plan?.request.broadcast===false&&op.error==='Wallet authorization interrupted or refused: Error: User rejected the transaction';
}
export function reservesFunding(op:Operation){
 // Signed outpoints normally disappear from listunspent. If they reappear after
 // a reorg, retain the reservation until the signed journal is reconciled.
 if(op.raw||op.txid||op.fundingRaw||op.childRaw)return true;
 if(op.step==='complete'&&op.stage==='confirmed'||legacyExplicitRefusal(op))return false;
 // Old unsigned reviews are safe only when no signing request could have escaped.
 // Legacy journals lack an approval marker: retain those conservatively unless explicitly refused/discarded.
 return !!(op.raw||op.txid||op.fundingRaw||op.childRaw||op.signing==='requested'||op.signing===undefined);
}
export function fundingReport(coins:WalletCoin[],queried:WalletKey[],reserved:Set<string>,unsigned:Set<string>,category?:string,network:'mainnet'|'chipnet'|'regtest'='chipnet'):FundingReport {
 const sum=(list:WalletCoin[])=>list.reduce((n,c)=>n+c.utxo.satoshis,0n).toString();
 const eligible=coins.filter(c=>!c.utxo.token||category===c.utxo.token.category&&!c.utxo.token.nft);
 const usable=eligible.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout));
 return {addressesQueried:queried.length,utxos:coins.length,total:sum(coins),confirmed:sum(coins.filter(c=>Number((c.utxo as {height?:number}).height)>0)),unconfirmed:sum(coins.filter(c=>typeof (c.utxo as {height?:number}).height==='number'&&Number((c.utxo as {height?:number}).height)<=0)),unclassified:sum(coins.filter(c=>(c.utxo as {height?:number}).height===undefined)),tokenFree:sum(coins.filter(c=>!c.utxo.token)),eligibleTokenCarriers:sum(eligible.filter(c=>!!c.utxo.token)),reserved:sum(eligible.filter(c=>reserved.has(c.utxo.txid+':'+c.utxo.vout))),unsignedReleased:sum(eligible.filter(c=>unsigned.has(c.utxo.txid+':'+c.utxo.vout)&&!reserved.has(c.utxo.txid+':'+c.utxo.vout))),unsupported:sum(coins.filter(c=>!eligible.includes(c))),ancestryExcluded:'0',unsupportedConditions:'0',available:sum(usable),availableInputs:usable.length,selectedInputs:0,milliseconds:0,reason:'',verification:'discovered',queried:queried.map(k=>({path:k.path,index:k.index,address:walletAddress(hexToBin(k.publicKey),network)}))};
}

/** A legacy signed funding parent may be evicted independently of its child.
 * Keep its original wallet inputs reserved if they reappear after a reorg. */
export function fundingOutpoints(op:Operation){
 return [...new Set([op.plan,op.fundingPlan].flatMap(p=>p?.request.transaction.inputs.map(i=>binToHex(i.outpointTransactionHash)+':'+i.outpointIndex)??[]))];
}
