import {stakingDurationDescription} from '../../src/v3/time-policy';
export function DurationSummary({seconds}:{seconds:number}){
 try{return <p className="duration-conversion">{stakingDurationDescription(seconds)}</p>;}
 catch{return <p className="duration-conversion">Enter a whole lock duration from 1 to 65,535 time units.</p>;}
}
