import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex} from '@bitauth/libauth';
import {ElectrumProvider} from '../src/electrum.js';
import {creationSequence} from '../src/queue/preparation.js';
import {BchFundingError,errorMessage} from '../src/queue/funding.js';
import {ZERO,ownerScript,parameterErrors,scoreErrors} from '../src/queue/protocol.js';
import type {WalletCoin} from '../src/transactions-core.js';
const signer=new SignatureTemplate(new Uint8Array(32).fill(81)),owner={publicKey:binToHex(signer.publicKey),path:'receive' as const,index:0};
const coin=(id:string,vout:number,satoshis:bigint,token?:WalletCoin['utxo']['token']):WalletCoin=>({...owner,utxo:{txid:id.repeat(64).slice(0,64),vout,satoshis,lockingBytecode:binToHex(ownerScript(signer.publicKey)),...(token?{token}:{})}});
const parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:1800000000,interval:600,releases:8,cap:1200n};
for(const network of ['mainnet','chipnet'] as const){
 const p=new ElectrumProvider({network,allowBroadcast:false});
 test(network+': exact reported balance layout funds complete creation',()=>{
  const cs=[coin('a',0,1200n),coin('a',1,865001n),coin('b',3,1500n)],s=creationSequence(parameters,cs,owner,p,1n);
  assert.equal(s.quote.transactions,2);assert.equal(s.quote.reserve,'9600');assert.equal(BigInt(s.quote.walletDebit),9600n+2400n+1000n+BigInt(s.quote.totalFee));assert.ok(s.selected.length>=2);
 });
 test(network+': verified funds with no genesis inputs prepare automatically',()=>{
  const s=creationSequence(parameters,[coin('a',1,867701n)],owner,p,2n);assert.equal(s.quote.transactions,3);
  assert.equal(BigInt(s.quote.totalFee),s.preparations.reduce((n,p)=>n+p.built.fee,0n)+s.created.fee);
  assert.equal(BigInt(s.quote.walletDebit),13000n+BigInt(s.quote.totalFee));
 });
 test(network+': BCH on unrelated tokens can fund token-preserving preparation',()=>{
  const s=creationSequence(parameters,[coin('a',0,1200n),coin('b',0,1500n),coin('c',1,865001n,{category:'dd'.repeat(32),amount:20n})],owner,p,1n);
  assert.equal(s.quote.transactions,3);assert.ok(s.preparations[0]!.built.raw);assert.equal(s.preparations[0]!.selected.length,3);
 });
 test(network+': genuine insufficiency sizes fees and carriers',()=>{
  assert.throws(()=>creationSequence(parameters,[coin('a',0,1200n),coin('b',0,1500n)],owner,p,2n),(e:unknown)=>{
   assert.ok(e instanceof BchFundingError);assert.equal(e.available,2700n);assert.equal(e.required,13000n+e.fee+546n);assert.ok(e.fee>0n);return true;
  });
 });
 test(network+': BCH and raw-token limits use protocol validation',()=>{
  assert.match(parameterErrors({...parameters,cap:1199n}).cap!,/1,200/);assert.deepEqual(parameterErrors(parameters),{});
  assert.deepEqual(parameterErrors({...parameters,rewardCategory:'ee'.repeat(32),cap:1n}),{});
  assert.match(scoreErrors({stake:1200n,reward:1199n,duration:512},parameters).reward!,/0.00001200/);
 });
}
test('error formatting removes repeated prefixes',()=>assert.equal(errorMessage(Error('Error: Error: test')),'test'));
