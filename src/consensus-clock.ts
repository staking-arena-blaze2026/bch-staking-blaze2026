import type {ElectrumCore,Header} from './electrum-core.js';
export const CHIPNET_ACTIVATION_MTP=1794744000;
export interface TickContext {activationHeight?:number;nextBlockTicks:number}
export type ChainClock={height:number;mtp:number;nextBlockTicks?:number};
export function blockTicks(height:number,activationHeight?:number){
 if(!Number.isSafeInteger(height)||height<0)throw Error('Invalid tick height');
 return activationHeight===undefined?height*600:Math.min(height,activationHeight)*600+Math.max(0,height-activationHeight)*60;
}
export function finalityLimit(clock:ChainClock){return (clock.nextBlockTicks??(clock.height+1)*600)/600;}
export function transactionFinal(tx:{locktime:number;inputs:{sequenceNumber:number}[]},clock:ChainClock){return tx.locktime===0||tx.locktime<(tx.locktime<500000000?finalityLimit(clock):clock.mtp)||tx.inputs.every(i=>i.sequenceNumber===0xffffffff);}
export function matureCoinbase(sourceHeight:number,context:TickContext){return sourceHeight>0&&context.nextBlockTicks-blockTicks(sourceHeight,context.activationHeight)>=60000;}
export function matureSequence(sourceHeight:number,units:number,context:TickContext){return context.nextBlockTicks>=blockTicks(sourceHeight,context.activationHeight)+units*600;}
const boundaries=new WeakMap<ElectrumCore,Map<string,{height:number;hash:string}>>();
/** Derive the first activated parent from linked selected-chain MTP. Never use a
 * physical-height approximation for coinbase, BIP68 or height nLockTime. */
export async function tickContext(p:ElectrumCore,tip:Header):Promise<TickContext>{
 if(p.network!=='chipnet')return {nextBlockTicks:(tip.height+1)*600};
 const mtp=await p.medianTime(tip.height,tip.hash);
 if(mtp<CHIPNET_ACTIVATION_MTP)return {nextBlockTicks:(tip.height+1)*600};
 let peers=boundaries.get(p);if(!peers){peers=new Map();boundaries.set(p,peers);}
 let boundary=peers.get(p.endpoint);
 if(!boundary){
  let low=0,high=tip.height;
  while(low<high){const mid=Math.floor((low+high)/2);if(await p.medianTime(mid)>=CHIPNET_ACTIVATION_MTP)high=mid;else low=mid+1;}
  const h=await p.header(low);
  if(low===0||await p.medianTime(low-1)>=CHIPNET_ACTIVATION_MTP||await p.medianTime(low,h.hash)<CHIPNET_ACTIVATION_MTP)throw Error('Invalid chipnet activation boundary');
  boundary={height:low,hash:h.hash};
 }
 const expected=new Map([[boundary.height,boundary.hash]]);
 // Independently context-validated upgraded-branch checkpoint, not a provider vote.
 if(tip.height>=332453)expected.set(332453,'0000000000001873af1d1672acde6b265b54e9f4a705981d923d22a2e0cafba3');
 await p.verifyHeaderChain(Math.max(0,Math.min(boundary.height-11,...expected.keys())),tip,expected);
 peers.set(p.endpoint,boundary);
 return {activationHeight:boundary.height,nextBlockTicks:blockTicks(tip.height+1,boundary.height)};
}
