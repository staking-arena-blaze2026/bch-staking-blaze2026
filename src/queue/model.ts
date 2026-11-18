import {Buffer} from '../bytes.js';
import {hash256,hexToBin} from '@bitauth/libauth';
export const ZERO='00'.repeat(32), CARRIER=1200n;
export interface Parameters {stakingCategory:string;rewardCategory:string;epoch:number;interval:number;releases:number;cap:bigint}
export interface Identity {vault:string;queue:string}
export interface Score {stake:bigint;duration:number;reward:bigint}
export interface Link extends Score {id:string}
export interface Offer extends Link {owner:string;next:Link}
export interface State {head:Link;reserve:bigint}
export const emptyLink=():Link=>({id:ZERO,stake:0n,duration:0,reward:0n});
export function u32(n:number|bigint){if(BigInt(n)<0n||BigInt(n)>2147483647n)throw Error('Unsigned Script field out of bounds');const b=Buffer.alloc(4);b.writeUInt32LE(Number(n));return b;}
export function category(c:string){if(!/^[a-f0-9]{64}$/.test(c))throw Error('Invalid category');return Buffer.from(c,'hex').reverse();}
export const minimumReward=(rewardCategory:string)=>rewardCategory===ZERO?CARRIER:1n;
export function parameterErrors(p:Parameters):Partial<Record<keyof Parameters,string>>{
 const errors:Partial<Record<keyof Parameters,string>>={};
 for(const field of ['stakingCategory','rewardCategory'] as const)if(!/^[a-f0-9]{64}$/.test(p[field]))errors[field]='Enter a 64-character lowercase hexadecimal token category.';
 if(!Number.isInteger(p.epoch)||p.epoch<500000000)errors.epoch='Enter a valid schedule start date and time.';
 if(!Number.isInteger(p.interval)||p.interval<1)errors.interval='Enter a positive whole-second interval.';
 if(!Number.isInteger(p.releases)||p.releases<1||p.releases>1000)errors.releases='Enter 1 to 1,000 whole releases.';
 if(p.cap<minimumReward(p.rewardCategory)||p.cap>1000000n)errors.cap=p.rewardCategory===ZERO?'Reward per release must be at least 0.00001200 BCH (1,200 satoshis) and at most 0.01000000 BCH.':'Reward per release must be 1 to 1,000,000 raw fungible units.';
 if(p.epoch+p.interval*p.releases>2147483647)errors.epoch='Shorten the schedule or choose an earlier start; its end exceeds the protocol timestamp limit.';
 return errors;
}
export function parameters(p:Parameters){const errors=parameterErrors(p);if(Object.keys(errors).length)throw Error(Object.values(errors).join(' '));return {assets:Buffer.concat([category(p.stakingCategory),category(p.rewardCategory)]),schedule:Buffer.concat([u32(p.epoch),u32(p.interval),u32(p.releases),u32(p.cap)])};}
export function scoreErrors(s:Score,p:Parameters):Partial<Record<keyof Score,string>>{
 const errors:Partial<Record<keyof Score,string>>={};
 if(s.stake<CARRIER||s.stake>1000000n)errors.stake=p.stakingCategory===ZERO?'Stake must be 0.00001200 to 0.01000000 BCH.':'Stake must be 1,200 to 1,000,000 raw fungible units.';
 if(!Number.isInteger(s.duration)||s.duration<512||s.duration>33553920||s.duration%512)errors.duration='Lock duration must be 1 to 65,535 whole 512-second time units.';
 if(s.reward<minimumReward(p.rewardCategory)||s.reward>1000000000n)errors.reward=p.rewardCategory===ZERO?'Requested reward must be at least 0.00001200 BCH and at most 10 BCH.':'Requested reward must be 1 to 1,000,000,000 raw fungible units.';
 return errors;
}
export function validateScore(s:Score,p:Parameters){const errors=scoreErrors(s,p);if(Object.keys(errors).length)throw Error(Object.values(errors).join(' '));}
export function compare(a:Score,b:Score){const d=a.stake*BigInt(a.duration)*b.reward-b.stake*BigInt(b.duration)*a.reward;return d<0n?-1:d>0n?1:0;}
export function score(s:Score){return Buffer.concat([u32(s.stake),u32(s.duration),u32(s.reward)]);}
export function link(l:Link){return Buffer.concat([Buffer.from(l.id,'hex'),score(l)]);}
export function record(o:Offer){return Buffer.concat([Buffer.from(o.id,'hex'),Buffer.from(o.owner,'hex'),score(o),link(o.next)]);}
export function state(s:State){return Buffer.concat([link(s.head),u32(s.reserve)]);}
export function decodeLink(b:Uint8Array):Link{if(b.length!==44)throw Error('Malformed link');const r=Buffer.from(b);return {id:r.subarray(0,32).toString('hex'),stake:BigInt(r.readUInt32LE(32)),duration:r.readUInt32LE(36),reward:BigInt(r.readUInt32LE(40))};}
export function decodeOffer(b:Uint8Array):Offer{if(b.length!==121)throw Error('Malformed node');const r=Buffer.from(b),self=decodeLink(Buffer.concat([r.subarray(0,32),r.subarray(65,77)]));return {...self,owner:r.subarray(32,65).toString('hex'),next:decodeLink(r.subarray(77,121))};}
export function decodeState(b:Uint8Array):State{if(b.length!==48)throw Error('Malformed vault state');const r=Buffer.from(b);return {head:decodeLink(r.subarray(0,44)),reserve:BigInt(r.readUInt32LE(44))};}
export function identifier(txid:string,vout:number){return Buffer.from(hash256(Buffer.concat([category(txid),u32(vout)]))).toString('hex');}
export function sameLink(a:Link,b:Link){return link(a).equals(link(b));}
export function rewardStatus(p:Parameters,s:State,reward:bigint,mtp:number){if(reward>s.reserve)return 'never-funded';const released=BigInt(Math.max(0,Math.min(p.releases,Math.floor((mtp-p.epoch)/p.interval))));return reward<=released*p.cap-(BigInt(p.releases)*p.cap-s.reserve)?'available':'awaiting-release';}
export function bytes(hex:string){return hexToBin(hex);}
