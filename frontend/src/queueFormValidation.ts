import {parameterErrors,scoreErrors,minimumReward,CARRIER,MAX_RELEASE,MAX_STAKE,MAX_REQUEST,type Parameters,type Score} from '../../src/queue/model';
import {assetInputUnits,amountInputError,categoryAsset,wholeTokenRange,assetAmount} from './assetAmounts';
import type {TokenMetadata} from './tokenMetadata';
import {parseLocalDateTime} from './localTime';
import {minutesToSeconds,stakingUnitsToSeconds} from '../../src/v3/time-policy';
import {errorMessage} from '../../src/queue/funding';

export function creationValidation(f:{stakingCategory:string;rewardCategory:string;cap:string;interval:string;releases:string;epoch:string},network:'mainnet'|'chipnet'|'regtest',metadata?:TokenMetadata){
 const asset=categoryAsset(f.rewardCategory),cap=assetInputUnits(asset,f.cap,metadata);let epoch=NaN,interval=NaN;
 const parsing:Partial<Record<keyof Parameters,string>>={};
 try{epoch=parseLocalDateTime(f.epoch);}catch(e){parsing.epoch=errorMessage(e);}
 try{interval=minutesToSeconds(f.interval,network);}catch(e){parsing.interval=errorMessage(e);}
 const p:Parameters={stakingCategory:f.stakingCategory,rewardCategory:f.rewardCategory,cap:cap??0n,interval,releases:Number(f.releases),epoch};
 const errors={...parameterErrors(p),...parsing};
 if(cap===null)errors.cap=amountInputError(asset,metadata);
 else if(errors.cap&&asset.kind==='token')errors.cap=wholeTokenRange(asset,minimumReward(p.rewardCategory),MAX_RELEASE,metadata);
 return {errors,parameters:Object.keys(errors).length?undefined:p};
}
export function offerValidation(p:Parameters,f:{stake:string;reward:string;duration:string},reserve?:bigint,stakingMetadata?:TokenMetadata,rewardMetadata?:TokenMetadata){
 const staking=categoryAsset(p.stakingCategory),rewards=categoryAsset(p.rewardCategory);
 const stake=assetInputUnits(staking,f.stake,stakingMetadata),reward=assetInputUnits(rewards,f.reward,rewardMetadata);let duration=NaN,durationError='';
 try{duration=stakingUnitsToSeconds(f.duration);}catch(e){durationError=errorMessage(e);}
 const terms:Score={stake:stake??0n,reward:reward??0n,duration},errors=scoreErrors(terms,p);
 if(stake===null)errors.stake=amountInputError(staking,stakingMetadata);
 else if(errors.stake&&staking.kind==='token')errors.stake=wholeTokenRange(staking,CARRIER,MAX_STAKE,stakingMetadata);
 if(reward===null)errors.reward=amountInputError(rewards,rewardMetadata);
 else if(errors.reward&&rewards.kind==='token')errors.reward=wholeTokenRange(rewards,minimumReward(p.rewardCategory),MAX_REQUEST,rewardMetadata);
 if(durationError)errors.duration=durationError;
 if(!errors.reward&&reward!==null&&reserve!==undefined&&reward>reserve)errors.reward=`Requested reward exceeds the remaining reserve of ${assetAmount(rewards,reserve,rewardMetadata)}.`;
 return {errors,terms:Object.keys(errors).length?undefined:terms,lockSeconds:durationError?undefined:duration};
}
