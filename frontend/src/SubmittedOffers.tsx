import {DurationSummary} from './DurationSummary';
import {localTimestamp} from './localTime';
import {useLayoutEffect,useRef} from 'react';
import type {Operation} from '../../src/v3/wallet';
import type {Snapshot} from '../../src/v3/indexer';
import {offerDisplayStatus} from '../../src/v3/offer-status';
import {assetAmount} from './createAssets';

/** Journal evidence is display-only: it never contributes to rankings or action authorization. */
export function SubmittedOffers({operations,genesis,snapshot}:{operations:Operation[];genesis?:string;snapshot?:Snapshot}){
 const rows=operations.filter(o=>o.kind==='offer'&&o.config?.genesis===genesis&&o.terms&&(o.step==='action'||!!o.raw))
 .filter(o=>!snapshot||snapshot.config.genesis!==genesis||![...(snapshot.history??[]),...(snapshot.pendingHistory??[])].includes(o.txid??''));
 const measured=useRef(new Set<string>()),ranked=useRef(new Set<string>());
 useLayoutEffect(()=>{for(const o of rows)if(o.acceptedAt&&!measured.current.has(o.id)){measured.current.add(o.id);window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:'offer',stage:'accepted-to-provisional-row',milliseconds:Math.max(0,Date.now()-o.acceptedAt)}}));}for(const o of operations)if(o.kind==='offer'&&o.config?.genesis===genesis&&o.acceptedAt&&snapshot&&[...(snapshot.history??[]),...(snapshot.pendingHistory??[])].includes(o.txid??'')&&!ranked.current.has(o.id)){ranked.current.add(o.id);window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:'offer',stage:'accepted-to-verified-queue',milliseconds:Math.max(0,Date.now()-o.acceptedAt)}}));}},[rows,operations,snapshot]);
 if(!rows.length)return null;
 return <section className="panel v3-submitted" aria-label="Locally submitted offers"><h2>Submitted offers — awaiting verified queue</h2><p>Saved transaction evidence and last observed status only; this is not proof of current confirmation. These offers have no verified rank. The live ranked queue below uses independently verified blockchain state. Status checks retry automatically; signed evidence remains recoverable.</p><div className="table-scroll"><table><thead><tr>{['Rank','Stake S','Lock duration (time units)','Requested reward R','Transaction ID','Status'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(o=><tr key={o.id}><td>Unranked</td><td>{assetAmount(o.parameters.stakingAsset,o.terms!.stake)}</td><td><DurationSummary seconds={o.terms!.duration}/></td><td>{assetAmount(o.parameters.rewardAsset,o.terms!.reward)}</td><td>{o.txid??'Not signed'}</td><td>{offerDisplayStatus(o)}{o.error&&<p>{o.error}</p>}</td></tr>)}</tbody></table></div></section>;
}
