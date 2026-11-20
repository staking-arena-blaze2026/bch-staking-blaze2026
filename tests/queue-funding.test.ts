import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex,encodeTransaction,hexToBin} from '@bitauth/libauth';
import {decodeRawTransaction} from '../src/electrum-core.js';
import {SettlementChain} from './fixtures/settlement-chain.js';
import {ElectrumProvider} from '../src/electrum.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {creationSequence} from '../src/queue/preparation.js';
import {BchFundingError,TokenFundingError,errorMessage} from '../src/queue/funding.js';
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
 test(network+': sufficient fragmented BCH is consolidated within the input bound',()=>{
  const coins=Array.from({length:20},(_,i)=>coin((i+1).toString(16).padStart(64,'0'),1,1000n));
  const s=creationSequence(parameters,coins,owner,p,1n);assert.equal(s.quote.transactions,3);assert.ok(s.preparations.every(p=>p.selected.length<=16));assert.ok(s.selected.length<=16);assert.equal(BigInt(s.quote.walletDebit),13000n+BigInt(s.quote.totalFee));
 });
 test(network+': genuine insufficiency sizes fees and carriers',()=>{
  assert.throws(()=>creationSequence(parameters,[coin('a',0,1200n),coin('b',0,1500n)],owner,p,2n),(e:unknown)=>{
   assert.ok(e instanceof BchFundingError);assert.equal(e.available,2700n);assert.equal(e.required,13000n+e.fee+546n);assert.ok(e.fee>0n);return true;
  });
 });
 test(network+': the reserve builder rejects a token balance one raw unit short',()=>{
  const category='dd'.repeat(32),payout={...parameters,rewardCategory:category,cap:1000000n,releases:1};
  const funding=[coin('a',0,50000n),coin('b',0,50000n),coin('c',1,1200n,{category,amount:999999n})];
  assert.throws(()=>creationSequence(payout,funding,owner,p,1n),(error:unknown)=>{
   assert.ok(error instanceof TokenFundingError);
   assert.deepEqual(error.balance,{category,required:1000000n,available:999999n});return true;
  });
  funding[2]=coin('c',1,1200n,{category,amount:1000000n});
  assert.equal(creationSequence(payout,funding,owner,p,1n).quote.reserve,'1000000');
 });
 test(network+': BCH and raw-token limits use protocol validation',()=>{
  assert.match(parameterErrors({...parameters,cap:1199n}).cap!,/1,200/);assert.deepEqual(parameterErrors(parameters),{});
  assert.deepEqual(parameterErrors({...parameters,rewardCategory:'ee'.repeat(32),cap:1n}),{});
  assert.match(scoreErrors({stake:1200n,reward:1199n,duration:512},parameters).reward!,/0.00001200/);
 });
}
test('error formatting removes repeated prefixes',()=>assert.equal(errorMessage(Error('Error: Error: test')),'test'));


function creationFixture() {
 const chain=new SettlementChain(),provider=chain.provider(),journal=new Map<string,Operation>();
 const wallet=new QueueWallet(provider,{
  list:async()=>structuredClone([...journal.values()]),
  save:async op=>{journal.set(op.id,structuredClone(op));},
 });
 const idsRead=new Set<string>();
 let relayFee=0.00001,sequence=0;
 const original=chain.request;
 chain.request=async(method,...params)=>{
  if(method==='blockchain.transaction.get'||method==='blockchain.transaction.get_merkle')idsRead.add(String(params[0]));
  return method==='blockchain.relayfee'?relayFee:original(method,...params);
 };
 function fund(satoshis:bigint,outputIndex:number) {
  const output={lockingBytecode:ownerScript(signer.publicKey),valueSatoshis:satoshis};
  const tx=decodeRawTransaction(binToHex(encodeTransaction({
   version:2,locktime:0,
   inputs:[{outpointTransactionHash:hexToBin((++sequence).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],
   outputs:outputIndex===0?[output]:[{lockingBytecode:Uint8Array.of(0x6a),valueSatoshis:0n},output],
  })));
  chain.transactions.set(tx.txid,tx);
  chain.mine([tx.txid]);
  return tx.txid;
 }
 return {chain,wallet,fund,journal,idsRead,setFee:(newFee:number)=>{relayFee=newFee;}};
}

for(const mode of ['connected','offline'] as const){
 test(mode+' vault quote uses reported outputs; authorization proves only the selected coins',async()=>{
  const {chain,wallet,fund,journal,idsRead}=creationFixture(),intent={kind:'create' as const,parameters};
  const first=fund(50000n,0),second=fund(40000n,0),unselected=fund(1200n,1);
  const quote=await wallet.prepare(intent,[owner],undefined,undefined,undefined,mode==='offline'?'preview':undefined);
  assert.equal(quote.quote?.transactions,1);
  assert.equal(new Set(chain.requestLog.map(r=>r.endpoint)).size,1,'one provider is sufficient for a quote');
  assert.deepEqual(idsRead,new Set(),'a quote reads no transaction bodies or Merkle proofs');
  assert.ok(!chain.requestLog.some(r=>r.method==='blockchain.block.headers'||r.method==='blockchain.scripthash.get_history'));
  let op=quote;
  if(mode==='offline'){
   assert.equal(journal.size,0);
   await assert.rejects(wallet.authorize(quote.id),/Unknown queue operation/);
   const before=chain.requestLog.length;
   op=await wallet.prepare(intent,[owner],undefined,undefined,undefined,structuredClone(quote));
   assert.equal(chain.requestLog.length,before,'accepting the offline quote does not rescan the wallet');
  }
  assert.equal(journal.size,1);
  if(mode==='offline')assert.equal(op.approved,true);
  await wallet.confirm(op.id);
  chain.requestLog.length=0;
  await wallet.authorize(op.id);
  assert.deepEqual(idsRead,new Set([first,second]));
  assert.ok(!idsRead.has(unselected),'same-address unselected output received no raw/proof request');
  assert.equal(new Set(chain.requestLog.filter(r=>r.method==='blockchain.transaction.get_merkle').map(r=>r.endpoint)).size,2);
 });
}

test('expanding a fallback quote preserves the inputs reserved for later steps',async()=>{
 const {wallet,fund}=creationFixture(),intent={kind:'create' as const,parameters};
 const origin=fund(15000n,0),selfSend=fund(50000n,1);
 const nextSigner=new SignatureTemplate(new Uint8Array(32).fill(82));
 const next={publicKey:binToHex(nextSigner.publicKey),path:'receive' as const,index:1};
 const initial=await wallet.prepare(intent,[owner],undefined,undefined,'same-click','preview');
 const expanded=await wallet.prepare(intent,[owner,next],undefined,undefined,'same-click','preview');
 assert.equal(expanded.quote?.approvals,2);
 assert.deepEqual(expanded.quote,initial.quote);
 assert.deepEqual(new Set(expanded.reservations?.map(coin=>coin.txid)),new Set([origin,selfSend]));
});

test('another request reserving the offline quote inputs requires fresh funding discovery',async()=>{
 const {chain,wallet,fund,journal}=creationFixture(),intent={kind:'create' as const,parameters};
 fund(50000n,0);fund(40000n,0);
 const preview=await wallet.prepare(intent,[owner],undefined,undefined,undefined,'preview');
 const existing=await wallet.prepare(intent,[owner]);
 const before=chain.requestLog.length;
 await assert.rejects(wallet.prepare(intent,[owner],undefined,undefined,undefined,preview),
  (error:Error&{details?:{code?:string}})=>error.details?.code==='creation-quote-stale');
 assert.deepEqual([...journal.keys()],[existing.id]);
 assert.equal(chain.requestLog.length,before);
});

test('a fabricated token reported on an ordinary BCH coin cannot authorize a token-reward vault',async()=>{
 const {chain,wallet,fund,idsRead}=creationFixture();
 fund(50000n,0);fund(40000n,0);
 const claimedToken=fund(30000n,1),category='ce'.repeat(32),original=chain.request;
 chain.request=async(method,...params)=>{
  const result=await original(method,...params);
  if(method!=='blockchain.scripthash.listunspent')return result;
  return result.map((row:{tx_hash:string})=>row.tx_hash===claimedToken?{...row,token_data:{category,amount:'50000'}}:row);
 };
 const op=await wallet.prepare({kind:'create',parameters:{...parameters,rewardCategory:category}},[owner]);
 assert.ok(op.sources.some(u=>u.token?.category===category));
 assert.equal(idsRead.size,0);
 await wallet.confirm(op.id);
 await assert.rejects(wallet.authorize(op.id),(error:Error&{details?:{code?:string}})=>error.details?.code==='selected-inputs-changed');
 await assert.rejects(wallet.beginSigning(op.id),/Fresh/);
});

test('a missing later-step input prevents the first self-send approval',async()=>{
 const {chain,fund,wallet,journal}=creationFixture();
 const future=fund(15000n,0),selfSendInput=fund(50000n,1);
 const op=await wallet.prepare({kind:'create',parameters},[owner]);
 assert.equal(op.quote?.transactions,2);
 assert.deepEqual(op.sources.map(u=>u.txid),[selfSendInput]);
 assert.ok(op.reservations?.some(u=>u.txid===future));
 await wallet.confirm(op.id);
 // Both providers now report the planned genesis input spent.
 chain.confirmed.delete(future);
 await assert.rejects(wallet.authorize(op.id),(error:Error&{details?:{code?:string}})=>error.details?.code==='selected-inputs-changed');
 await assert.rejects(wallet.beginSigning(op.id),/Fresh/);
 assert.equal(journal.get(op.id)?.signing,'unsigned');
 assert.deepEqual(chain.broadcasts,[]);
});

test('a fee change after quoting requires new creation costs before signing',async()=>{
 const {fund,wallet,setFee}=creationFixture(),intent={kind:'create' as const,parameters};
 fund(50000n,0);fund(60000n,0);
 const op=await wallet.prepare(intent,[owner]);
 await wallet.confirm(op.id);
 setFee(0.00002);
 await assert.rejects(wallet.authorize(op.id),/Fee policy changed/);
 await assert.rejects(wallet.beginSigning(op.id),/Fresh/);
 const changed=await wallet.resume(op.id,[owner]);
 assert.ok(BigInt(changed.quote!.totalFee)>BigInt(op.quote!.totalFee));
 assert.equal(changed.approved,false);
});
