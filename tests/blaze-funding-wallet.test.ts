import test from 'node:test';
import assert from 'node:assert/strict';
import {Network,SignatureTemplate} from 'cashscript';
import {binToHex,encodeTransaction,hexToBin} from '@bitauth/libauth';
import {decodeRawTransaction,type ElectrumCore} from '../src/electrum-core.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {walletScript,type WalletKey} from '../src/transactions-core.js';
import {utxo} from '../src/arena-core.js';
import type {FundingReport} from '../src/v3/funding-report.js';
const publicKey=binToHex(new SignatureTemplate(new Uint8Array(32).fill(81)).publicKey),keys:WalletKey[]=[{publicKey,path:'receive',index:0}];
const parameters={version:3 as const,stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'bch' as const},epoch:1800000000,periodSeconds:100,periods:10,cap:1000n};
function fixture(values=[50000n,50000n]){
 const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:new Uint8Array(32),outpointIndex:0xffffffff,sequenceNumber:0xffffffff,unlockingBytecode:Uint8Array.of(1,1)}],outputs:values.map(valueSatoshis=>({valueSatoshis,lockingBytecode:hexToBin(walletScript(publicKey))}))}));
 const tx={...decodeRawTransaction(raw),height:1,confirmations:200};
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}};
 const transactions=new Map([[tx.txid,tx]]),coins=[utxo(tx,0),utxo(tx,1)];
 const provider={network:Network.REGTEST,endpoints:['mock://one','mock://two'],session:async<T>(work:()=>Promise<T>)=>work(),tip:async()=>({height:200,hash:'a'}),medianTime:async()=>1700000000,getUtxosForLockingBytecode:async()=>coins,transactionStatus:async(id:string)=>transactions.get(id)} as unknown as ElectrumCore;
 let report:FundingReport|undefined;return {wallet:new AssetWallet(provider,store,()=>{},r=>{report=r;}),report:()=>report!,journal,transactions,tx,coins};
}
test('new unsigned attempts and explicit refusals release funds, while uncertain authorizations block reuse',async()=>{
 const f=fixture(),first=await f.wallet.create(parameters,keys);assert.equal(first.creationMode,'direct');
 const second=await f.wallet.create(parameters,keys);assert.equal(f.report().reserved,'0');
 await f.wallet.authorize(first.id);
 await f.wallet.authorize(second.id).then(()=>assert.fail('must not approve overlapping plans'),e=>assert.match(String(e),/reserved/));
 await f.wallet.signingFailed(first.id,'Authenticated refusal',true);assert.equal((await f.wallet.create(parameters,keys)).creationMode,'direct');
 assert.equal(f.report().reserved,'0');assert.equal(f.journal.get(first.id)!.signing,'rejected');
});
test('an immature high-value coin does not hide sufficient valid alternative funding',async()=>{
 const f=fixture(),raw=binToHex(encodeTransaction({version:2,locktime:1,inputs:[{outpointTransactionHash:new Uint8Array(32),outpointIndex:0xffffffff,sequenceNumber:0xffffffff,unlockingBytecode:Uint8Array.of(1,2)}],outputs:[{valueSatoshis:900000n,lockingBytecode:hexToBin(walletScript(publicKey))}]}));
 const tx={...decodeRawTransaction(raw),height:200,confirmations:1};f.transactions.set(tx.txid,tx);f.coins.unshift(utxo(tx,0));
 const op=await f.wallet.create(parameters,keys);assert.equal(op.creationMode,'direct');assert.equal(f.report().unsupportedConditions,'900000');assert.ok(!op.plan!.request.transaction.inputs.some(i=>binToHex(i.outpointTransactionHash)===tx.txid));
});
test('uncertain signed and pre-marker legacy journal entries stay reserved',async()=>{
 const f=fixture(),first=await f.wallet.create(parameters,keys);f.journal.set(first.id,{...first,signing:undefined});
 const second=await f.wallet.create(parameters,keys);assert.equal(second.creationMode,'chained');assert.equal(f.report().reserved,'50000');
 f.journal.set(second.id,{...second,raw:'uncertain bytes',txid:'ab'.repeat(32)});
 await assert.rejects(()=>f.wallet.create(parameters,keys),/reserved by an unresolved transaction/);
 assert.equal(f.journal.get(second.id)!.raw,'uncertain bytes');
});

test('exact historical Cashonize cancellation releases the 809333-sat reservation without deleting the journal',async()=>{
 const f=fixture([809333n,3000n]),op=await f.wallet.createLegacy({...parameters,cap:2000n,periods:3},keys);
 assert.equal(op.plan!.request.sourceOutputs.reduce((n,o)=>n+o.valueSatoshis,0n),809333n);
 f.journal.set(op.id,{...op,signing:undefined,error:'Wallet authorization interrupted or refused: Error: User rejected the transaction'});
 const next=await f.wallet.create(parameters,keys);assert.equal(next.creationMode,'direct');assert.equal(f.report().reserved,'0');assert.ok(f.journal.has(op.id));
 f.journal.set(op.id,{...op,signing:undefined,error:'Wallet authorization interrupted or refused: Error: Transaction outcome unknown, it may have been sent'});
 await assert.rejects(()=>f.wallet.create(parameters,keys),/reserved by an unresolved transaction/);assert.equal(f.report().reserved,'809333');assert.equal(f.report().available,'3000');
});
