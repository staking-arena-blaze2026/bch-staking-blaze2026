import type {Parameters} from '../../src/queue/model';

export function queueRewardSchedule(p:Parameters,remaining:bigint,mtp:number) {
 // Releases unlock only once MTP has passed the boundary.
 const unlocked=Math.max(0,Math.min(p.releases,Math.floor((mtp-1-p.epoch)/p.interval)));
 const future=BigInt(p.releases-unlocked)*p.cap;
 // The on-chain reserve already includes released rewards that nobody has claimed.
 const available=remaining>future?remaining-future:0n;
 const nextRelease=unlocked<p.releases?p.epoch+(unlocked+1)*p.interval:undefined;
 return {unlocked,available,nextRelease};
}
