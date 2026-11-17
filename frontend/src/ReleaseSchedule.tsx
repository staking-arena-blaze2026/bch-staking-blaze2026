import {memo,useState} from 'react';
import type {Snapshot} from '../../src/v3/indexer';
import {releaseDisplay} from '../../src/v3/release-display';
import {formatDuration} from '../../src/v3/time-policy';
import {localTimestamp,browserTimezone} from './localTime';
import {assetAmount} from './createAssets';
export const ReleaseSchedule=memo(function ReleaseSchedule({snapshot,verified,verifiedAt,now}:{snapshot:Snapshot;verified:boolean;verifiedAt:number;now:number}){
 const [expanded,setExpanded]=useState(false);
 const p=snapshot.config,time=releaseDisplay(p,snapshot.instance.state,snapshot.clock.mtp,verifiedAt,now,verified&&!snapshot.provisional&&!snapshot.pending.length);
 return <section aria-label="Reward release timing"><h3>Reward release timing</h3>
 <p>Local time: {localTimestamp(now/1000)}</p><p>Blockchain time (MTP): {time.fresh?localTimestamp(snapshot.clock.mtp):'Unavailable / unverified (missing, stale or pending blockchain state)'}</p>
 <p>Timezone: {browserTimezone()}. Rewards follow the vault&apos;s scheduled release intervals, but become available when blockchain time reaches the required boundary. Several releases may become available together.</p>
 <p>Timestamp-based claims require verified blockchain MTP to be strictly greater than the release boundary (BIP113). Local time alone does not unlock rewards.</p>
 <dl><dt>Next scheduled reward release</dt><dd>{time.next?localTimestamp(time.next):time.fresh?'All scheduled releases unlocked':'Unavailable / unverified'}</dd>
 <dt>Next release status</dt><dd>{time.next?time.status(time.next):time.fresh?'All scheduled releases unlocked':'Unavailable / unverified'}</dd>
 <dt>Release amount</dt><dd>{assetAmount(p.rewardAsset,p.cap)} every {formatDuration(p.periodSeconds)}</dd>
 <dt>Number of releases currently unlocked</dt><dd>{time.unlocked??'Unavailable / unverified'} / {p.periods}</dd>
 <dt>Total reward currently available for claiming</dt><dd>{time.available===undefined?'Unavailable / unverified':assetAmount(p.rewardAsset,time.available)}</dd></dl>
 <p>Unlocked rewards accumulate in the pot. A claim also needs an eligible top-ranked offer; an offer requesting more than the pot cannot win yet. Already paid rewards are deducted from the pot.</p>
 <details onToggle={e=>setExpanded(e.currentTarget.open)}><summary>Release schedule and history</summary>{expanded&&<div className="table-scroll" style={{maxHeight:320,overflowY:'auto'}}><table><thead><tr><th>Release</th><th>Scheduled local time</th><th>Amount</th><th>Blockchain status</th></tr></thead><tbody>{Array.from({length:p.periods},(_,i)=>{const boundary=p.epoch+(i+1)*p.periodSeconds,status=time.status(boundary);return <tr key={i}><td>{i+1}</td><td>{localTimestamp(boundary)}</td><td>{assetAmount(p.rewardAsset,p.cap)}</td><td>{status==='Available'&&time.available===0n?'Released — pot already claimed':status}</td></tr>;})}</tbody></table></div>}<p>Available marks an unlocked boundary. Rewards are pooled; the total above accounts for claims already paid.</p></details>
 </section>;
});
