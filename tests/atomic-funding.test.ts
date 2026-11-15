import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAtomicFunding} from '../src/v3/atomic-funding.js';
import type {WalletCoin} from '../src/transactions-core.js';
const coin=(id:number,satoshis:bigint,token?:WalletCoin['utxo']['token']):WalletCoin=>({publicKey:'',path:'receive',index:0,utxo:{txid:id.toString(16).padStart(64,'0'),vout:0,satoshis,lockingBytecode:'',...(token?{token}:{})}});
test('atomic funding accepts exact BCH and exact token/carrier accounting without padding',()=>{
 assert.equal(selectAtomicFunding([coin(1,12000n)],{kind:'bch'},2000n).length,1);
 const category='aa'.repeat(32),asset={kind:'token' as const,category};
 assert.equal(selectAtomicFunding([coin(2,10000n,{category,amount:2000n})],asset,2000n).length,1);
 assert.equal(selectAtomicFunding([coin(3,11000n,{category,amount:3000n})],asset,2000n).length,1);
});
test('atomic funding excludes NFTs/unrelated assets and never turns dust change into fees',()=>{
 const category='aa'.repeat(32),asset={kind:'token' as const,category},ft=coin(1,11000n,{category,amount:3000n});
 assert.deepEqual(selectAtomicFunding([coin(2,100000n,{category,amount:100000n,nft:{capability:'none',commitment:''}}),coin(3,100000n,{category:'bb'.repeat(32),amount:100000n}),ft],asset,2000n),[ft]);
 assert.throws(()=>selectAtomicFunding([coin(1,12500n)],{kind:'bch'},2000n),/Insufficient/);
 assert.equal(selectAtomicFunding([coin(1,12500n),coin(2,1000n)],{kind:'bch'},2000n).length,2);
});

test('legacy parent wallet inputs remain reserved alongside registration inputs',async()=>{
 const {fundingOutpoints}=await import('../src/v3/funding-report.js');
 const plan=(id:number)=>({request:{transaction:{inputs:[{outpointTransactionHash:new Uint8Array(32).fill(id),outpointIndex:0}]}}});
 const operation={plan:plan(1),fundingPlan:plan(2)} as unknown as import('../src/v3/wallet.js').Operation;
 assert.deepEqual(fundingOutpoints(operation),['01'.repeat(32)+':0','02'.repeat(32)+':0']);
});
