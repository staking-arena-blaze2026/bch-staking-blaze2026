import {Buffer} from '../bytes.js';
import {records,rankings} from '../arena-core.js';
import {periodBoundary} from '../registry.js';
export {assetId,assetBytes,ZERO,FEE,CARRIER,type Asset} from '../v2/model.js';
import {assetId,type Asset} from '../v2/model.js';
export interface Parameters {version:3;registryVersion?:4;stakingAsset:Asset;rewardAsset:Asset;epoch:number;periodSeconds:number;periods:number;cap:bigint}
export interface Terms {stake:bigint;duration:number;reward:bigint;maxWins:number}
export const V3_STATE_SIZE=794;
export function validateParameters(p:Parameters){
 if(p.registryVersion!==undefined&&p.registryVersion!==4)throw Error('Unsupported registry covenant version');
 if(p.version!==3)throw Error('Unsupported covenant version');assetId(p.stakingAsset);assetId(p.rewardAsset);
 if(typeof p.cap!=='bigint'||p.cap<(p.rewardAsset.kind==='bch'?1000n:1n)||p.cap>1000000n||!Number.isInteger(p.periods)||p.periods<1||p.periods>16)throw Error('Invalid release count or amount');
 if(!Number.isSafeInteger(p.periodSeconds)||p.periodSeconds>2147483647)throw Error('Invalid release interval');
 periodBoundary(p,p.periods);return p;
}
export function validateTerms(p:Parameters,t:Terms,remaining=p.cap*BigInt(p.periods)){
 validateParameters(p);
 if(typeof t.stake!=='bigint'||typeof t.reward!=='bigint'||t.stake<1000n||t.stake>1000000n||t.reward<(p.rewardAsset.kind==='bch'?1000n:1n)||t.reward>remaining||!Number.isInteger(t.duration)||t.duration<1||t.duration>33553920||!Number.isInteger(t.maxWins)||t.maxWins<1||t.maxWins>16)throw Error('Invalid offer or requested reward exceeds remaining reserve');
 return t.stake*BigInt(t.maxWins);
}
export function exactPriority(t:Terms){return {numerator:t.stake*BigInt(t.duration),denominator:t.reward};}
export function rewardRemaining(state:Uint8Array){if(state.length!==V3_STATE_SIZE)throw Error('Invalid v3 state length');return BigInt(Buffer.from(state).readUInt32LE(790));}
export function releaseCount(p:Parameters,time:number){if(!Number.isSafeInteger(time))throw Error('Invalid consensus time');return Math.max(0,Math.min(p.periods,Math.floor((time-p.epoch)/p.periodSeconds)));}
/** Pass tip MTP - 1, the greatest currently final timestamp locktime. */
export function buffer(p:Parameters,state:Uint8Array,time:number){const reserve=rewardRemaining(state),paid=p.cap*BigInt(p.periods)-reserve,available=p.cap*BigInt(releaseCount(p,time))-paid;return available<0n?0n:available>reserve?reserve:available;}
export function decision(v:{state:Uint8Array;parameters:Parameters},clock:{mtp:number}){
 const state=Buffer.from(v.state),queue=rankings(state,false),available=buffer(v.parameters,state,clock.mtp-1),reserve=rewardRemaining(state),top=queue[0];
 if(!top)return {phase:'blocked',reason:'No active offers',available,reserve} as const;
 if(BigInt(top.reward)>reserve)return {phase:'blocked',reason:'Top offer exceeds remaining reserve and can never be paid; it remains ranked until cancelled or displaced by a new higher-priority offer',available,reserve,top} as const;
 if(BigInt(top.reward)>available)return {phase:'blocked',reason:'Top offer exceeds available buffer; waiting for reward releases',available,reserve,top} as const;
 return {phase:'ready',action:3,slot:top.slot,available,reserve,top} as const;
}
export function initialState(p:Parameters){validateParameters(p);const b=Buffer.alloc(V3_STATE_SIZE);b.writeUInt32LE(Number(p.cap*BigInt(p.periods)),790);return b;}
/** Deterministic witness replay; the covenant independently checks every transition. */
export function advance(state:Uint8Array,action:number,slot=0,record=new Uint8Array()){
 const s=Buffer.from(state);rewardRemaining(s);const entries=records(s,false),entry=entries[slot];
 if(!Number.isInteger(slot)||slot<0||slot>=16)throw Error('Invalid slot');
 if(action===0){if(slot!==s[5]||slot>=16||record.length!==49)throw Error('Registration capacity or record invalid');s[5]=slot+1;s.set(record,6+slot*49);}
 else if(action===1){if(!entry||entry.cancelled)throw Error('Invalid cancellation');s[6+slot*49+47]=1;}
 else if(action===3){if(rankings(s,false)[0]?.slot!==slot)throw Error('Only the highest-ranked offer can claim');if(!entry||BigInt(entry.reward)>rewardRemaining(s))throw Error('Insufficient remaining reserve');s[6+slot*49+46]!++;s.writeUInt32LE(Number(rewardRemaining(s)-BigInt(entry.reward)),790);}
 else if(action===4){if(!entry||!entry.cancelled||entry.refunded||entry.wins>=entry.maxWins)throw Error('Invalid refund');s[6+slot*49+48]=1;}
 else throw Error('Unsupported v3 action');return s;
}
export function allocationSequence(seconds:number){if(!Number.isInteger(seconds)||seconds<1||seconds>33553920)throw Error('Invalid duration');return 0x400000+Math.ceil(seconds/512);}
