import {buffer,releaseCount,type Parameters} from './model.js';
export const BLOCKCHAIN_TIME_FRESH_MS=30000;
export type ReleaseStatus='Scheduled'|'Awaiting blockchain time'|'Available'|'Unavailable / unverified';
/** Display only. Transaction preparation always independently verifies chain state again.
 * BIP113: a timestamp locktime equal to tip MTP is not final. */
export function releaseDisplay(p:Parameters,state:Uint8Array,mtp:number|undefined,verifiedAt:number,nowMs:number,verified:boolean){
 const chainTime=mtp??NaN;
 const fresh=verified&&Number.isSafeInteger(chainTime)&&chainTime>0&&verifiedAt>0&&nowMs>=verifiedAt&&nowMs-verifiedAt<=BLOCKCHAIN_TIME_FRESH_MS;
 const unlocked=fresh?releaseCount(p,chainTime-1):undefined;
 const available=fresh?buffer(p,state,chainTime-1):undefined;
 const status=(boundary:number):ReleaseStatus=>!fresh?'Unavailable / unverified':chainTime>boundary?'Available':nowMs/1000<boundary?'Scheduled':'Awaiting blockchain time';
 const next=unlocked===undefined?undefined:unlocked>=p.periods?undefined:p.epoch+(unlocked+1)*p.periodSeconds;
 return {fresh,unlocked,available,next,status};
}
