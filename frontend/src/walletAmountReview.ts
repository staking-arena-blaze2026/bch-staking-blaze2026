import {binToHex} from '@bitauth/libauth';
import type {WalletPlan} from '../../src/transactions-core';
import type {V3Network} from '../../src/v3/network';
import type {Asset} from '../../src/v2/model';
import {assetAmount,tokenAsset} from './assetAmounts';
import {fetchTokenMetadata} from './tokenMetadata';

export interface ReviewAmount {label:string;asset:Asset;raw:bigint}
type Request=WalletPlan['request'];

function outputAmounts(request:Request):ReviewAmount[]{
 return (request.transaction?.outputs??[]).flatMap((output,index)=>{
  const token=output.token;
  return token&&token.amount>0n?[{label:`Output ${index+1}`,asset:tokenAsset(binToHex(token.category)),raw:token.amount}]:[];
 });
}

export async function loadWalletAmountReview(network:V3Network,preview:Request,amounts:ReviewAmount[]=[]){
 const categories=[...new Set([...amounts,...outputAmounts(preview)].flatMap(({asset})=>asset.kind==='token'?[asset.category]:[]))];
 const metadata=new Map(await Promise.all(categories.map(async category=>[category,await fetchTokenMetadata(network,category)] as const)));
 // The final description uses the authorized outputs. No asynchronous lookup
 // happens after the wallet's freshness and session checks.
 return (request:Request,title:string)=>{
  const items=[...amounts,...outputAmounts(request)];
  if(!items.length)return {request,label:undefined};
  const lines=items.map(({label,asset,raw})=>`${label} ${assetAmount(asset,raw,asset.kind==='token'?metadata.get(asset.category):undefined)}`);
  const label=[title,...lines].join(' · ');
  return {request:{...request,userPrompt:label},label};
 };
}

export function stakingReviewAmounts(kind:string,p:{stakingAsset:Asset;rewardAsset:Asset;cap:bigint;periods:number},terms?:{stake:bigint;reward:bigint;maxWins?:number}):ReviewAmount[]{
 if(kind==='create')return [{label:'Reward per release',asset:p.rewardAsset,raw:p.cap},{label:'Total reward reserve',asset:p.rewardAsset,raw:p.cap*BigInt(p.periods)}];
 if(!terms)return [];
 const amounts=[{label:'Stake',asset:p.stakingAsset,raw:terms.stake},{label:'Requested reward',asset:p.rewardAsset,raw:terms.reward}];
 if((terms.maxWins??1)>1)amounts.push({label:'Total stake commitment',asset:p.stakingAsset,raw:terms.stake*BigInt(terms.maxWins!)});
 return amounts;
}
