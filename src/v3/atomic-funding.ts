import {chooseBch} from '../electrum-wallet.js';
import {FundingSelectionError} from '../wallet-funding-policy.js';
import type {WalletCoin} from '../transactions-core.js';
import {FEE,CARRIER,type Asset} from './model.js';
/** Registration reuses the existing escrow carrier. Select only this asset and BCH;
 * permit exact funding, and never absorb small change into the fixed miner fee. */
export function selectAtomicFunding(coins:WalletCoin[],asset:Asset,stake:bigint){
 const eligible=coins.filter(c=>!c.utxo.token||asset.kind==='token'&&c.utxo.token.category===asset.category&&!c.utxo.token.nft);
 const tokens=eligible.filter(c=>!!c.utxo.token).sort((a,b)=>a.utxo.token!.amount>b.utxo.token!.amount?-1:1);
 const used:WalletCoin[]=[];let amount=0n;
 while(asset.kind==='token'&&amount<stake){const next=tokens.shift();if(!next)throw new FundingSelectionError('tokens','Insufficient eligible staking tokens');used.push(next);amount+=next.utxo.token!.amount;}
 for(;;){
  const required=FEE+(asset.kind==='bch'?stake:amount>stake?CARRIER:0n);
  try{let selected=chooseBch(eligible,required,used),change=selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-required;
   if(change>0n&&change<CARRIER)selected=chooseBch(eligible,required+CARRIER,used);
   if(selected.length>16)throw new FundingSelectionError('input-limit','Atomic registration supports at most sixteen wallet inputs');return selected;
  }catch(error){
   // More eligible staking carriers can supply BCH, without consuming unrelated tokens.
   const next=asset.kind==='token'?tokens.shift():undefined;if(!next)throw error;
   used.push(next);amount+=next.utxo.token!.amount;
  }
 }
}
