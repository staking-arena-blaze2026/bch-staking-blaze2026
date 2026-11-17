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
export function parameters(p:Parameters){category(p.stakingCategory);category(p.rewardCategory);if(!Number.isInteger(p.epoch)||p.epoch<500000000||!Number.isInteger(p.interval)||p.interval<1||!Number.isInteger(p.releases)||p.releases<1||p.releases>1000||p.cap<1n||p.cap>1000000n||p.epoch+p.interval*p.releases>2147483647||p.rewardCategory===ZERO&&p.cap<1200n)throw Error('Invalid queue parameters');return {assets:Buffer.concat([category(p.stakingCategory),category(p.rewardCategory)]),schedule:Buffer.concat([u32(p.epoch),u32(p.interval),u32(p.releases),u32(p.cap)])};}
export function validateScore(s:Score,p:Parameters){if(s.stake<1200n||s.stake>1000000n||!Number.isInteger(s.duration)||s.duration<512||s.duration>33553920||s.duration%512||s.reward<1n||s.reward>1000000000n||p.rewardCategory===ZERO&&s.reward<1200n)throw Error('Invalid offer terms; duration must be whole 512-second units');}
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
