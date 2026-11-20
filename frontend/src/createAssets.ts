import {assetId,validateParameters,type Asset,type Parameters,CARRIER,FEE} from '../../src/v2/model';
import {amountInputError,assetInputUnits,wholeTokenRange} from './assetAmounts';
import type {TokenMetadata} from './tokenMetadata';
import {integer} from './marketplace';
import {validateVaultParameters,vaultFunding} from '../../src/wallet-terms';
export type AssetKind=Asset['kind'];
export function createQuote(stakingAsset:Asset,rewardAsset:Asset,capText:string,periodsText:string,durationText:string,epoch:string,preferredVersion?:1|2,rewardMetadata?:TokenMetadata){
 assetId(stakingAsset);assetId(rewardAsset);
 const cap=assetInputUnits(rewardAsset,capText,rewardMetadata),periods=integer(periodsText),duration=integer(durationText);
 if(cap===null)throw Error(amountInputError(rewardAsset,rewardMetadata));
 if(periods===null||duration===null||!epoch)throw Error('Enter whole periods, a whole-second duration and UTC start.');
 if(rewardAsset.kind==='token'&&cap>1000000n)throw Error(wholeTokenRange(rewardAsset,1n,1000000n,rewardMetadata));
 const parameters:Parameters=validateParameters({version:2,stakingAsset,rewardAsset,cap,periods:Number(periods),periodSeconds:Number(duration),epoch:Date.parse(epoch+'Z')/1000});
 const reserve=cap*periods;
 if(preferredVersion!==2&&stakingAsset.kind==='token'&&rewardAsset.kind==='bch'){
  const legacy=validateVaultParameters({stakingCategory:stakingAsset.category,cap:Number(cap),periods:parameters.periods,periodSeconds:parameters.periodSeconds,epoch:parameters.epoch});
  const funding=vaultFunding(legacy);
  return {version:1 as const,parameters:legacy,reserve,funding,requiredBch:funding.total+CARRIER,requiredTokens:0n};
 }
 // Same fixed preparation/genesis layout as AssetWallet.prepare. Change is wallet-owned.
 const carriers=3n*CARRIER,fees=2n*FEE,change=CARRIER+(rewardAsset.kind==='token'?CARRIER:0n);
 return {version:2 as const,parameters,reserve,carriers,fees,change,requiredBch:carriers+fees+change+(rewardAsset.kind==='bch'?reserve:0n),requiredTokens:rewardAsset.kind==='token'?reserve:0n};
}
export const V2_CREATION_WARNING='V2 EXPERIMENTAL — CHIPNET TEST FUNDS ONLY. Real Cashonize signing remains unverified. Funding is irreversible and unused rewards have no creator refund. Preparation and genesis require separate wallet approvals, with confirmed funding between them.';
