import type {V3Network} from './network';
export const STAKING_UNIT_SECONDS=512;
export const MAX_STAKING_UNITS=65535;
export const minimumMinutes=(network:V3Network)=>network==='mainnet'?10:1;
export const intervalStepMinutes=minimumMinutes;
export function validateNewTime(seconds:number,network:V3Network,label='Interval'):number {
 const step=intervalStepMinutes(network)*60;
 if(!Number.isSafeInteger(seconds)||seconds<step||seconds%step!==0)throw Error(`${label} must be a positive multiple of ${minimumMinutes(network)} minute${minimumMinutes(network)===1?'':'s'} on ${network}`);
 return seconds;
}
export function minutesToSeconds(value:string,network:V3Network,label='Interval'):number {
 const minutes=Number(value);
 if(!value.trim()||!Number.isSafeInteger(minutes))throw Error(label+' must be a whole number of minutes');
 return validateNewTime(minutes*60,network,label);
}
export function stakingUnitsToSeconds(value:string|number):number {
 const units=Number(value);
 if((typeof value==='string'&&!value.trim())||!Number.isSafeInteger(units)||units<1||units>MAX_STAKING_UNITS)throw Error('Lock duration must be a whole number from 1 to 65,535 time units');
 return units*STAKING_UNIT_SECONDS;
}
export function stakingSecondsToUnits(seconds:number):number {
 const units=seconds/STAKING_UNIT_SECONDS;
 stakingUnitsToSeconds(units);
 return units;
}
/** Exact integer decomposition; never round a staking or release duration. */
export function formatDuration(seconds:number):string {
 if(!Number.isSafeInteger(seconds)||seconds<0)throw Error('Invalid duration');
 const parts:string[]=[];
 for(const [name,size] of [['week',604800],['day',86400],['hour',3600],['minute',60],['second',1]] as const){
  const count=Math.floor(seconds/size);seconds%=size;
  if(count)parts.push(`${count} ${name}${count===1?'':'s'}`);
 }
 return parts.join(', ')||'0 seconds';
}
export function stakingDurationDescription(seconds:number):string {
 const units=stakingSecondsToUnits(seconds);
 return `Lock duration: ${units} time unit${units===1?'':'s'}. Equivalent duration: ${formatDuration(seconds)}. ${units} × 512 = ${seconds.toLocaleString('en-US')} seconds. Actual withdrawal eligibility depends on blockchain MTP and confirmation timing.`;
}
