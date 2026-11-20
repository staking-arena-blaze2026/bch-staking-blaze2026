import {assetInputUnits,amountInputError,wholeTokenRange,tokenAsset,bchAsset} from './assetAmounts';
import type {TokenMetadata} from './tokenMetadata';
import {scheduledPolicy} from '../../src/offer-policy';
import { ranked, type Envelope, type Vault } from './model';
export type Route = { page:'home'|'create'|'v2'|'v3'|'missing' } | {page:'v2vault';id:string} | { page:'vault'|'offer'; id:string };
export function routeFromHash(hash:string):Route {
  const path=hash.replace(/^#/, '').split('?')[0] || '/';
  if(path==='/'||path==='/v1') return {page:'home'};
  const v2=path.match(/^\/v2\/vault\/([a-f0-9]{64})$/i);
  if(v2)return {page:'v2vault',id:v2[1].toLowerCase()};
  if(/^\/v3(?:\/(?:offers|my-offers|vault\/[a-f0-9]{64}))?$/i.test(path)) return {page:'v3'};
  if(path==='/v2') return {page:'v2'};
  if(path==='/create') return {page:'create'};
  const match=path.match(/^\/vault\/([a-f0-9]{64})(\/offer)?$/i);
  return match ? {page:match[2]?'offer':'vault',id:match[1].toLowerCase()} : {page:'missing'};
}
export const vaultHref=(id:string)=>`#/vault/${id}`;
export function periodLength(seconds:number) {
  return seconds===86400?'Daily':seconds===604800?'Weekly':seconds===3600?'Hourly':seconds%86400===0?`Every ${seconds/86400} days`:seconds%3600===0?`Every ${seconds/3600} hours`:seconds===60?'Every minute':seconds%60===0?`Every ${seconds/60} minutes`:`Every ${seconds} seconds`;
}
export function vaultSchedule(v:Vault,tip:Envelope['tip'],now=Date.now()) {
 return tip?scheduledPolicy(v.config,v.period,v.phase==='activated',now/1000,tip.mtp):undefined;
}
export function vaultStatus(v:Vault,tip:Envelope['tip'],now=Date.now()) {
 return v.transactionStatus==='unconfirmed'?'Pending / Unconfirmed (0-conf)':v.period>=v.config.periods?'Completed — all periods processed on-chain':vaultSchedule(v,tip,now)?.status??'Status unavailable';
}
export function registrationAllowed(v:Vault,tip:Envelope['tip'],stale:boolean,now=Date.now()) {
 return v.transactionStatus!=='unconfirmed'&&!stale&&v.offers.length<16&&!!vaultSchedule(v,tip,now)?.offersAllowed;
}
export const competingOffers=(v:Vault)=>ranked(v.phase==='activated'?(v.snapshot??v.rankings):v.offers);
export function integer(value:string):bigint|null {
  return /^\d{1,30}$/.test(value)?BigInt(value):null;
}
export const rewardSatoshis=(value:string)=>assetInputUnits(bchAsset,value);
export function offerPreview(s:string,t:string,r:string,w:string,v:Vault,metadata?:TokenMetadata) {
  const asset=tokenAsset(v.config.stakingCategory);
  const stake=assetInputUnits(asset,s,metadata),duration=integer(t),reward=rewardSatoshis(r),wins=integer(w);
  if(stake===null)return {error:amountInputError(asset,metadata)};
  if(duration===null||reward===null||wins===null) return {error:'Enter whole periods and a BCH amount with up to 8 decimal places.'};
  if(stake<1000n||stake>1000000n) return {error:wholeTokenRange(asset,1000n,1000000n,metadata)};
  if(duration<1n||duration>BigInt(v.config.periods)||wins<1n||wins>BigInt(v.config.periods)) return {error:`Duration and maximum wins must each be 1–${v.config.periods}.`};
  if(reward<1000n||reward>BigInt(v.config.cap)||reward>1000000n) return {error:'Requested reward must be at least 0.00001000 BCH and no more than the vault cap.'};
  return {commitment:stake*wins,terms:{stake:Number(stake),duration:Number(duration),reward:Number(reward),maxWins:Number(wins)}};
}
