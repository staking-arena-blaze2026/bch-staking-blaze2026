import {useState} from 'react';
import type {Parameters} from '../../src/queue/model';
import {localTimestamp,browserTimezone} from './localTime';
import {assetAmount} from './createAssets';
import {ZERO} from '../../src/queue/model';
export function QueueReleaseSchedule({parameters:p,reserve,mtp,verifiedAt,now,verified}:{parameters:Parameters;reserve:bigint;mtp:number;verifiedAt:number;now:number;verified:boolean}){
 const [expanded,setExpanded]=useState(false);
 const fresh=verified&&verifiedAt>0&&now>=verifiedAt&&now-verifiedAt<=30000;
 const unlocked=Math.max(0,Math.min(p.releases,Math.floor((mtp-1-p.epoch)/p.interval)));
 const available=BigInt(unlocked)*p.cap-(BigInt(p.releases)*p.cap-reserve);
 const reward=p.rewardCategory===ZERO?{kind:'bch' as const}:{kind:'token' as const,category:p.rewardCategory};
 const status=(boundary:number)=>!fresh?'Unavailable / unverified':mtp>boundary?'Available':now/1000<boundary?'Scheduled':'Awaiting blockchain time';
 return <section aria-label="Reward release timing"><h3>Reward release timing</h3><p>Local time: {localTimestamp(now/1000)}</p><p>Blockchain time (MTP): {fresh?localTimestamp(mtp):'Unavailable / unverified'}</p><p>Timezone: {browserTimezone()}. Scheduled rewards become available when blockchain MTP passes the release boundary. Unclaimed rewards accumulate; local time alone does not unlock them.</p><dl><dt>Next scheduled reward release</dt><dd>{fresh?(unlocked<p.releases?localTimestamp(p.epoch+(unlocked+1)*p.interval):'All scheduled releases unlocked'):'Unavailable / unverified'}</dd><dt>Number of releases currently unlocked</dt><dd>{fresh?unlocked:'Unavailable / unverified'} / {p.releases}</dd><dt>Total reward currently available for claiming</dt><dd>{fresh?assetAmount(reward,available>0n?available:0n):'Unavailable / unverified'}</dd></dl><details onToggle={e=>setExpanded(e.currentTarget.open)}><summary>Release schedule and history</summary>{expanded&&<div className="table-scroll" style={{maxHeight:320,overflowY:'auto'}}><table><thead><tr><th>Release</th><th>Scheduled local time</th><th>Amount</th><th>Blockchain status</th></tr></thead><tbody>{Array.from({length:p.releases},(_,i)=><tr key={i}><td>{i+1}</td><td>{localTimestamp(p.epoch+(i+1)*p.interval)}</td><td>{assetAmount(reward,p.cap)}</td><td>{status(p.epoch+(i+1)*p.interval)}</td></tr>)}</tbody></table></div>}<p>Available marks an unlocked boundary. The total above deducts rewards already claimed.</p></details></section>;
}
