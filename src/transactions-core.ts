import {binToHex,hexToBin,secp256k1,decodeTransaction,encodeTransaction,decodeAuthenticationInstructions,encodeCashAddress,hash160,type Transaction} from '@bitauth/libauth';
import {Network,TransactionBuilder,placeholderP2PKHUnlocker,placeholderSignature,type NetworkProvider,type SpendableUtxo} from 'cashscript';
import {Buffer} from './bytes.js';
import {contract,contracts,utxo} from './arena-core.js';
import {hashState,nextState,offer,remainingCommitment,STATE_SIZE} from './registry.js';
import type {GenesisParameters} from './genesis-core.js';
import type {VaultState} from './indexer-core.js';
import {sourceOutput,validateKeeperTransaction,type KeeperClock} from './keeper-core.js';
import {validateVaultParameters,vaultFunding,validateOfferTerms,type OfferTerms} from './wallet-terms.js';
export type WalletPath=[number,'receive'|'change'|'defi',number];
export interface WalletKey {fundingHint?:boolean;publicKey:string;path:'receive'|'change'|'defi';index:number}
export interface WalletCoin extends WalletKey {utxo:SpendableUtxo}
export interface WalletPlan {label:string;request:ReturnType<TransactionBuilder['generateWcTransactionObject']>;inputPaths:WalletPath[]}
export interface BrowserPlan extends WalletPlan {kind:'create'|'prepare-offer'|'offer';signers:Record<number,string>;fee:string}
export function walletAddress(key:Uint8Array) {
 if(key.length!==33||![2,3].includes(key[0]!)||!secp256k1.validatePublicKey(key))throw Error('Expected compressed wallet public key');
 const address=encodeCashAddress({prefix:'bchtest',type:'p2pkhWithTokens',payload:hash160(key)});if(typeof address==='string')throw Error(address);return address.address;
}
export function walletScript(key:string) {const pub=hexToBin(key);walletAddress(pub);return '76a914'+binToHex(hash160(pub))+'88ac';}
function chipnet(p:NetworkProvider){if(p.network!==Network.CHIPNET)throw Error('Wallet flows are chipnet-only');}
function walletCoin(c:WalletCoin) {
 if(!['receive','change','defi'].includes(c.path)||!Number.isSafeInteger(c.index)||c.index<0||c.index>=200||c.utxo.lockingBytecode!==walletScript(c.publicKey))throw Error('Wallet funding key/script mismatch');
}
function makePlan(kind:BrowserPlan['kind'],label:string,builder:TransactionBuilder,coins:WalletCoin[],offset=0,owner?:WalletKey):BrowserPlan {
 const inputPaths:WalletPath[]=coins.map((c,i)=>{walletCoin(c);return [i+offset,c.path,c.index];});
 const signers:Record<number,string>=Object.fromEntries(coins.map((c,i)=>[i+offset,c.publicKey]));
 if(owner){inputPaths.unshift([0,owner.path,owner.index]);signers[0]=owner.publicKey;}
 const request=builder.generateWcTransactionObject({broadcast:false,userPrompt:'CHIPNET TEST FUNDS ONLY: '+label});
 const tx=request.transaction as Transaction,fee=request.sourceOutputs.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 return {kind,label,request,inputPaths,signers,fee:fee.toString()};
}
function inputs(builder:TransactionBuilder,coins:WalletCoin[]) {
 if(!coins.length||coins.length>8||new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('Select one to eight distinct wallet inputs');
 for(const c of coins){walletCoin(c);builder.addInput(c.utxo,placeholderP2PKHUnlocker(walletAddress(hexToBin(c.publicKey))));}
 return builder;
}
export async function buildCreatePlan(p:GenesisParameters,coins:WalletCoin[],change:WalletKey,provider:NetworkProvider,reserve=vaultFunding(p).reserve) {
 chipnet(provider);validateVaultParameters(p);
 if(coins.some(c=>c.utxo.token)||reserve<vaultFunding(p).reserve)throw Error('Insufficient lifecycle reserve or token-bearing fee funding');
 const factory=await contract('RegistryGenesis',[Buffer.from(p.stakingCategory,'hex').reverse(),BigInt(p.epoch),BigInt(p.periodSeconds),BigInt(p.periods),BigInt(p.cap)],provider);
 const amount=coins.reduce((n,c)=>n+c.utxo.satoshis,0n)-reserve-13000n;
 if(amount<1000n)throw Error('Insufficient BCH: reserve, both genesis steps and change carrier are required');
 return makePlan('create',`Create Vault: ${p.periods} periods, cap ${p.cap} sats, duration ${p.periodSeconds}s, UTC epoch ${p.epoch}, staking ${p.stakingCategory}; factory ${reserve+11000n} sats + 2000 fee; no refund`,inputs(new TransactionBuilder({provider}),coins).addOutput({to:factory.address,amount:reserve+11000n}).addOutput({to:walletAddress(hexToBin(change.publicKey)),amount}),coins);
}
export async function buildGenesis(p:GenesisParameters,parent:any,provider:NetworkProvider,clock:KeeperClock) {
 chipnet(provider);validateVaultParameters(p);
 if(parent.txid===p.stakingCategory)throw Error('State and staking categories must differ');
 const input=utxo(parent,0),factory=await contract('RegistryGenesis',[Buffer.from(p.stakingCategory,'hex').reverse(),BigInt(p.epoch),BigInt(p.periodSeconds),BigInt(p.periods),BigInt(p.cap)],provider),cs=await contracts({...p,genesis:''},parent.txid,provider);
 if(input.token||input.lockingBytecode!==factory.lockingBytecode)throw Error('Incorrect token-free factory output zero');
 const raw=new TransactionBuilder({provider}).addInput(input,factory.unlock.create()).addOutput({to:cs.registry.tokenAddress,amount:input.satoshis-11000n,token:{category:parent.txid,amount:0n,nft:{capability:'mutable',commitment:hashState(Buffer.alloc(STATE_SIZE))}}}).addOutput({to:cs.pool.address,amount:1000n}).build();
 validateKeeperTransaction(raw,[sourceOutput(input)],clock,10000n);return raw;
}
export async function buildPreparation(coins:WalletCoin[],owner:WalletKey,change:WalletKey,category:string,amount:bigint,provider:NetworkProvider) {
 chipnet(provider);
 if(amount<=0n||!coins.some(c=>c.utxo.token)||coins.some(c=>c.utxo.token&&(c.utxo.token.nft||c.utxo.token.category!==category)))throw Error('Preparation accepts only the selected fungible category and token-free BCH sponsors');
 const tokens=coins.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n),bch=coins.reduce((n,c)=>n+c.utxo.satoshis,0n);
 if(tokens<amount||bch<13000n)throw Error('Insufficient exact token commitment or BCH preparation funding');
 return makePlan('prepare-offer',`Prepare ${amount} fungible units of ${category} in a 10000-sat wallet output; fee 2000 sats; token/BCH change preserved; REGISTER approval is separate`,inputs(new TransactionBuilder({provider}),coins).addOutput({to:walletAddress(hexToBin(owner.publicKey)),amount:10000n,token:{category,amount}}).addOutput({to:walletAddress(hexToBin(change.publicKey)),amount:bch-12000n,...(tokens>amount?{token:{category,amount:tokens-amount}}:{})}),coins);
}
export async function buildRegistration(vault:VaultState,coin:WalletCoin,owner:WalletKey,t:OfferTerms,provider:NetworkProvider,clock:KeeperClock) {
 chipnet(provider);const amount=validateOfferTerms(vault.config,t),state=Buffer.from(vault.witness,'hex'),slot=state[5]!;
 if(state[4]||slot>=16||state.readUInt32LE(0)>=vault.config.periods)throw Error('Registration is closed: activated, completed, or lifetime capacity reached');
 if(coin.utxo.satoshis!==10000n||coin.utxo.token?.nft||coin.utxo.token?.category!==vault.config.stakingCategory||coin.utxo.token.amount!==amount)throw Error('REGISTER requires exactly S × W fungible units and exactly 10,000 satoshis');
 walletCoin(coin);const record=offer(hexToBin(owner.publicKey),t.stake,t.duration,t.reward,t.maxWins),next=nextState(state,0,slot,record),cs=await contracts(vault.config,vault.category,provider),s=utxo(vault.transaction,0),pool=utxo(vault.transaction,1);
 if(s.lockingBytecode!==cs.registry.lockingBytecode||pool.lockingBytecode!==cs.pool.lockingBytecode||s.token?.nft?.commitment!==hashState(state))throw Error('Registry preimage/source mismatch');
 const builder=new TransactionBuilder({provider}).setLocktime(clock.mtp-1).addInput(s,cs.registry.unlock.transition(state,0n,BigInt(slot),record,placeholderSignature())).addInput(pool,cs.pool.unlock.spend());
 inputs(builder,[coin]);builder.addOutput({to:cs.registry.tokenAddress,amount:s.satoshis,token:{category:vault.category,amount:0n,nft:{capability:'mutable',commitment:hashState(next)}}}).addOutput({to:cs.pool.tokenAddress,amount:1000n,token:{category:vault.config.stakingCategory,amount:remainingCommitment(next)}});
 return makePlan('offer',`REGISTER vault ${vault.category}, slot ${slot}: S=${t.stake}, T=${t.duration}, R=${t.reward} sats, W=${t.maxWins}; deposit ${amount} units; fee 10000 sats; owner ${owner.publicKey}`,builder,[coin],2,owner);
}
/** Identity of the approved bytes/sources, excluding display labels/compiler timestamps. */
export function walletPlanIdentity(plan:BrowserPlan) {
 return JSON.stringify({transaction:binToHex(encodeTransaction(plan.request.transaction as Transaction)),sources:plan.request.sourceOutputs.map(o=>({value:o.valueSatoshis.toString(),script:binToHex(o.lockingBytecode),token:o.token?{category:binToHex(o.token.category),amount:o.token.amount.toString(),nft:o.token.nft?{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}:null}:null})),inputPaths:plan.inputPaths,signers:plan.signers,kind:plan.kind,fee:plan.fee});
}
const zeroSignature='00'.repeat(65);
export function validateWalletSigned(plan:BrowserPlan,raw:string,clock:KeeperClock,validator=validateKeeperTransaction) {
 if(typeof raw!=='string'||raw.length>200000||! /^(?:[a-f0-9]{2})+$/i.test(raw))throw Error('Invalid or oversized signed transaction');
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed signed transaction');
 const expected=plan.request.transaction as Transaction,shape=(v:Transaction)=>binToHex(encodeTransaction({...v,inputs:v.inputs.map(i=>({...i,unlockingBytecode:new Uint8Array()}))}));
 if(shape(tx)!==shape(expected))throw Error('Wallet changed inputs, outputs, amounts, version, or locktime');
 for(const [n,input] of tx.inputs.entries()) {
  const key=plan.signers[n],source=plan.request.sourceOutputs[n];
  if(!key){if(binToHex(input.unlockingBytecode)!==binToHex(expected.inputs[n].unlockingBytecode))throw Error('Unsigned covenant unlocking data changed');continue;}
  const actual=decodeAuthenticationInstructions(input.unlockingBytecode);
  const sig=(a:any)=>a?.data?.length===65&&a.data[64]===0x61;
  if(!source.contract){if(actual.length!==2||!sig(actual[0])||!('data' in actual[1])||binToHex(actual[1].data!)!==key||binToHex(source.lockingBytecode)!==walletScript(key))throw Error('Wallet must supply Schnorr ALL|UTXOS|FORKID signatures with the selected public key');}
  else {
   const template=decodeAuthenticationInstructions(expected.inputs[n].unlockingBytecode);
   if(template.length!==actual.length)throw Error('Covenant witness changed');let count=0;
   for(let k=0;k<template.length;k++){const a=template[k],b=actual[k];if('data' in a&&a.data&&binToHex(a.data)===zeroSignature){if(!sig(b))throw Error('Missing 0x61 covenant authorization');count++;}else if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Covenant witness changed');}
   if(count!==1)throw Error('Expected exactly one covenant authorization');
  }
 }
 return validator(raw,plan.request.sourceOutputs.map(o=>({valueSatoshis:o.valueSatoshis,lockingBytecode:o.lockingBytecode,...(o.token?{token:o.token}:{})})),clock,BigInt(plan.fee));
}
