import {parameterErrors,scoreErrors,ZERO,type Parameters,type Score} from '../../src/queue/model';
import {assetInputUnits} from './createAssets';
import {parseLocalDateTime} from './localTime';
import {minutesToSeconds,stakingUnitsToSeconds} from '../../src/v3/time-policy';
import {errorMessage} from '../../src/queue/funding';
const asset=(category:string)=>category===ZERO?{kind:'bch' as const}:{kind:'token' as const,category};
export function creationValidation(f:{stakingCategory:string;rewardCategory:string;cap:string;interval:string;releases:string;epoch:string},network:'mainnet'|'chipnet'|'regtest'){
 const cap=assetInputUnits(asset(f.rewardCategory),f.cap);let epoch=NaN,interval=NaN;
 const parsing:Partial<Record<keyof Parameters,string>>={};
 try{epoch=parseLocalDateTime(f.epoch);}catch(e){parsing.epoch=errorMessage(e);}
 try{interval=minutesToSeconds(f.interval,network);}catch(e){parsing.interval=errorMessage(e);}
 const p:Parameters={stakingCategory:f.stakingCategory,rewardCategory:f.rewardCategory,cap:cap??0n,interval,releases:Number(f.releases),epoch};
 const errors={...parameterErrors(p),...parsing};
 if(cap===null)errors.cap=f.rewardCategory===ZERO?'Enter a BCH reward with at most 8 decimal places.':'Enter a whole number of raw fungible token units; token decimals are not assumed.';
 return {errors,parameters:Object.keys(errors).length?undefined:p};
}
export function offerValidation(p:Parameters,f:{stake:string;reward:string;duration:string},reserve?:bigint){
 const stake=assetInputUnits(asset(p.stakingCategory),f.stake),reward=assetInputUnits(asset(p.rewardCategory),f.reward);let duration=NaN,durationError='';
 try{duration=stakingUnitsToSeconds(f.duration);}catch(e){durationError=errorMessage(e);}
 const terms:Score={stake:stake??0n,reward:reward??0n,duration},errors=scoreErrors(terms,p);
 if(stake===null)errors.stake='Enter a valid stake amount in the displayed asset units.';
 if(reward===null)errors.reward='Enter a valid requested reward in the displayed asset units.';
 if(durationError)errors.duration=durationError;
 if(reward!==null&&reserve!==undefined&&reward>reserve)errors.reward='Requested reward exceeds the remaining reserve. Reduce the reward or choose another vault.';
 return {errors,terms:Object.keys(errors).length?undefined:terms,lockSeconds:durationError?undefined:duration};
}
