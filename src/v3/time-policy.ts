import type {V3Network} from './network';

/** New form entries use whole minutes; on-chain durations remain seconds. */
export const minimumMinutes=(network:V3Network)=>network==='mainnet'?10:1;
export function validateNewTime(seconds:number,network:V3Network,label:string):number {
 const minimumSeconds=network==='regtest'?1:minimumMinutes(network)*60;
 if(!Number.isSafeInteger(seconds)||seconds<minimumSeconds)throw Error(label+' must be at least '+minimumMinutes(network)+' minute'+(minimumMinutes(network)===1?'':'s')+' on '+network);
 return seconds;
}
export function minutesToSeconds(value:string,network:V3Network,label:string):number {
 const minutes=Number(value);
 if(!value.trim()||!Number.isSafeInteger(minutes))throw Error(label+' must be a whole number of minutes');
 if(minutes<minimumMinutes(network))throw Error(label+' must be at least '+minimumMinutes(network)+' minute'+(minimumMinutes(network)===1?'':'s')+' on '+network);
 return validateNewTime(minutes*60,network,label);
}
