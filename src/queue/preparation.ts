import {BchFundingError} from './funding.js';
import {TransactionBuilder,placeholderP2PKHUnlocker} from 'cashscript';
import {hexToBin,binToHex,hashTransaction,type Transaction} from '@bitauth/libauth';
import {walletAddress,type WalletCoin,type WalletKey} from '../transactions-core.js';
import * as q from './protocol.js';
import type {ElectrumCore} from '../electrum-core.js';
import {addAnnouncement} from './discovery.js';
export interface CreationQuote {transactions:number;approvals:number;preparationFees:string[];creationFee:string;totalFee:string;walletDebit:string;reserve:string;rewardCategory:string;recovery?:{operationId:string;transactionId:string;reservedBch:string;returnedBch:string}}
function sequence(p:q.Parameters,coins:WalletCoin[],owner:WalletKey,provider:ElectrumCore,rate:bigint,consolidate=false){
 const network=String(provider.network) as 'mainnet'|'chipnet'|'regtest';
 const funding=(c:WalletCoin):q.Funding=>({input:c.utxo,unlocker:placeholderP2PKHUnlocker(walletAddress(hexToBin(c.publicKey),network))});
 const eligible=(cs:WalletCoin[])=>cs.filter(c=>!c.utxo.token&&c.utxo.vout===0&&![q.ZERO,p.stakingCategory,p.rewardCategory].includes(c.utxo.txid));
 let inventory=[...coins];const preparations:{built:ReturnType<typeof q.priced>;selected:WalletCoin[]}[]=[];
 function send(selected:WalletCoin[],split:boolean){
  if(!selected.length||selected.length>16)throw Error('Insufficient independent BCH funding for safe preparation');
  const total=selected.reduce((n,c)=>n+c.utxo.satoshis,0n),script=q.ownerScript(hexToBin(owner.publicKey)),tokens=new Map<string,bigint>();
  for(const c of selected)if(c.utxo.token){if(c.utxo.token.nft)throw Error('Preparation cannot spend NFTs');tokens.set(c.utxo.token.category,(tokens.get(c.utxo.token.category)??0n)+c.utxo.token.amount);}
  const built=q.priced(fee=>{
   const b=new TransactionBuilder({provider});for(const c of selected){const f=funding(c);b.addInput(f.input,f.unlocker);}
   if(split)b.addOutput({to:script,amount:1000n});
   const amount=q.fundingRemainder(b,total,(split?1000n:0n)+BigInt(tokens.size)*1000n,fee,'wallet preparation',false);
   b.addOutput({to:script,amount:amount<546n?546n:amount});
   for(const [category,amount]of tokens)b.addOutput({to:script,amount:1000n,token:{category,amount}});return b;
  },selected.map(c=>c.utxo),rate);
  const tx=built.builder.generateWcTransactionObject().transaction as Transaction;
  // Project only sizes/fees. Real txids are obtained from retained signed bytes,
  // then independently verified before the next operation can be authorized.
  const txid=hashTransaction(hexToBin(built.raw));
  const outputs:WalletCoin[]=tx.outputs.map((o,vout)=>({...owner,utxo:{txid,vout,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount}}:{})}}));
  inventory=inventory.filter(c=>!selected.includes(c)).concat(outputs);preparations.push({built,selected});return outputs;
 }
 function sendFew(candidates:WalletCoin[],split:boolean){
  const selected:WalletCoin[]=[];let last:unknown;
  for(const coin of candidates.slice(0,16)){selected.push(coin);try{return send(selected,split);}catch(e){if(!/Insufficient BCH/.test(String(e)))throw e;last=e;}}
  throw last??Error('Insufficient independent BCH funding for safe preparation');
 }
 const origins=eligible(inventory);
 if(consolidate){
  const candidates=[...inventory].sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1).slice(0,16);
  const outputs=send(candidates,true);send([outputs[1]!],false);
 }else if(origins.length<2){
  const candidates=[...inventory].sort((a,b)=>a.utxo.token&&!b.utxo.token?1:!a.utxo.token&&b.utxo.token?-1:a.utxo.satoshis>b.utxo.satoshis?-1:1),independent=candidates.filter(c=>!origins.includes(c));
  let prepared=false;
  if(origins.length===1&&independent.length){try{sendFew(independent,false);prepared=true;}catch(e){if(!/Insufficient BCH/.test(String(e)))throw e;}}
  if(!prepared){const outputs=sendFew(candidates,true);send([outputs[1]!],false);}
 }
 const [vault,queue]=eligible(inventory);if(!vault||!queue||vault.utxo.txid===queue.utxo.txid)throw Error('Two distinct category origins could not be prepared');
 let selected=[vault,queue];
 const build=()=>q.create(p,funding(vault),funding(queue),selected.slice(2).map(funding),{publicKey:hexToBin(owner.publicKey),authorization:new Uint8Array(65)},provider,rate,{cost:1000n,add:(b,c)=>addAnnouncement(b,provider,{parameters:c.p,creator:owner.publicKey,queue:c.identity.queue})});
 const available=inventory.filter(c=>c!==vault&&c!==queue&&(!c.utxo.token||p.rewardCategory!==q.ZERO&&c.utxo.token.category===p.rewardCategory));
 available.sort((a,b)=>a.utxo.token&&!b.utxo.token?-1:!a.utxo.token&&b.utxo.token?1:a.utxo.satoshis>b.utxo.satoshis?-1:1);
 let created:ReturnType<typeof q.create>;
 for(;;){try{created=build();break;}catch(e){if(!/Insufficient BCH|Insufficient tokens|dust/i.test(String(e))||!available.length||selected.length>=16){if(e instanceof BchFundingError)throw new BchFundingError(e.required+preparations.reduce((n,s)=>n+s.built.fee,0n)+inventory.filter(c=>c.utxo.token&&c.utxo.token.category!==p.rewardCategory).reduce((n,c)=>n+c.utxo.satoshis,0n),coins.reduce((n,c)=>n+c.utxo.satoshis,0n),e.fee,'full creation sequence',preparations.reduce((n,s)=>n+s.built.fee,0n));throw e;}selected.push(available.shift()!);}}
 const tx=created.builder.generateWcTransactionObject().transaction as Transaction,script=binToHex(q.ownerScript(hexToBin(owner.publicKey)));
 const preparationFees=preparations.map(s=>s.built.fee.toString()),extra=preparations.reduce((n,s)=>n+s.built.fee,0n),totalFee=extra+created.fee;
 const quote:CreationQuote={transactions:preparations.length+1,approvals:preparations.length+1,preparationFees,creationFee:created.fee.toString(),totalFee:totalFee.toString(),walletDebit:(selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-tx.outputs.filter(o=>binToHex(o.lockingBytecode)===script).reduce((n,o)=>n+o.valueSatoshis,0n)+extra).toString(),reserve:(p.cap*BigInt(p.releases)).toString(),rewardCategory:p.rewardCategory};
 return {quote,preparations,created,selected};
}

/** Preserve the direct path. If BCH is attached to unrelated fungible tokens
 * or spread across too many inputs, quote wallet-only consolidation that
 * returns every token category.
 * Quote the complete sequence before asking for any signatures. */
export function creationSequence(p:q.Parameters,coins:WalletCoin[],owner:WalletKey,provider:ElectrumCore,rate:bigint){
 try{return sequence(p,coins,owner,provider,rate);}catch(error){
  if(!(error instanceof BchFundingError)||coins.length<=16&&!coins.some(c=>c.utxo.token&&!c.utxo.token.nft&&c.utxo.token.category!==p.rewardCategory))throw error;
  return sequence(p,coins,owner,provider,rate,true);
 }
}
