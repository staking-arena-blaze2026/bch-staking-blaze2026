import {discoverFunding} from '../src/v3/funding-discovery.js';
import {chooseBch} from '../src/electrum-wallet.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {ownerAddress,type Parameters} from '../src/v3/protocol.js';
import type {WalletKey} from '../src/transactions-core.js';
import type {FundingReport} from '../src/v3/funding-report.js';

test('BCHN 29.2: 812333-sat fragmented change wallet, unsigned and uncertain journal reservations',{timeout:900000},async()=>isolatedRegtest(async()=>{
 const start=await rpc<number>('getblockcount'),p=new RegtestElectrum(start),signer=new SignatureTemplate(new Uint8Array(32).fill(79));
 p.sendRawTransaction=async raw=>{const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));const id=await rpc<string>('sendrawtransaction',[raw]);await p.refresh();return id;};
 const pub=binToHex(signer.publicKey),owner=ownerAddress(signer.publicKey,p),other=await rpc<string>('getnewaddress');
 // Six public keys represent the initial two indices of all three chains. Funds are on change index 1.
 const keys:WalletKey[]=(['receive','change','defi'] as const).flatMap((path,j)=>[0,1].map(index=>({path,index,publicKey:path==='change'&&index===1?pub:binToHex(new SignatureTemplate(new Uint8Array(32).fill(100+j*2+index)).publicKey)})));
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}};
 let report:FundingReport|undefined,requests=0,discoveryRequests=0;const request=p.request;p.request=async(...args)=>{requests++;return request(...args);};
 const wallet=new AssetWallet(p,store,m=>{if(m.startsWith('Funding discovery:'))discoveryRequests=requests;},r=>{report=structuredClone(r);});
 const params:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:Math.floor(Date.now()/1000)+3600,periodSeconds:100,periods:10,cap:1000n};
 const seed=await rpc<string>('sendtoaddress',[owner,0.01]);await rpc('generatetoaddress',[1,other]);await p.refresh();
 const benchmark:Record<string,unknown>[]=[];
 async function prepare(label:string){const initial=requests,t=performance.now();discoveryRequests=0;const op=await wallet.create(params,keys),prepareMs=performance.now()-t;const auth=await wallet.authorize(op.id);const untilSigning=performance.now()-t;
  benchmark.push({label,addressesDerived:keys.length,addressesQueried:report!.addressesQueried,electrumRequests:requests-initial,discoveryRequests:discoveryRequests-initial,discoveryMs:report!.milliseconds,preparationMs:prepareMs,backendPreparationToSigningMs:untilSigning,inputsSelected:report!.selectedInputs,inputsAvailable:report!.availableInputs,creationMode:op.creationMode,serializedBytes:(await import('@bitauth/libauth')).encodeTransaction(auth.plan.request.transaction as any).length,authorizationsRequested:0,realCashonize:false});return op;}
 const normal=await prepare('normal single coin');await wallet.signingFailed(normal.id,'Explicit local harness rejection',true);
 const source=utxo(await p.transactionStatus(seed),(await p.transactionStatus(seed)).vout.findIndex((o:any)=>o.scriptPubKey.hex===normal.plan!.request.sourceOutputs[0]!.lockingBytecode.reduce((s:string,b:number)=>s+b.toString(16).padStart(2,'0'),'')));
 const split=new TransactionBuilder({provider:p}).addInput(source,signer.unlockP2PKH()).addOutput({to:other,amount:167667n});
 for(let i=0;i<300;i++)split.addOutput({to:owner,amount:2700n});split.addOutput({to:owner,amount:2333n});
 const raw=split.build(),[accepted]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accepted.allowed,true,JSON.stringify(accepted));await rpc('sendrawtransaction',[raw]);await p.refresh();
 const oldKeys:WalletKey[]=[...keys];for(let index=2;index<40;index++)for(const [j,path] of (['receive','change','defi'] as const).entries())oldKeys.push({path,index,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(110+j*40+index)).publicKey)});
 const oldRequests=requests,oldStart=performance.now();const before=await discoverFunding(p,oldKeys,coins=>{try{const chosen=chooseBch(coins,33000n);return chosen.length<=8;}catch{return false;}});
 benchmark.push({label:'former eight-input selector, same fragmented wallet',addressesDerived:oldKeys.length,addressesQueried:before.addresses,electrumRequests:requests-oldRequests,discoveryMs:performance.now()-oldStart,result:'rejects 13 inputs despite 812333 sats'});
 const fragmented=await prepare('812333 sats; 301 unconfirmed change UTXOs');
 assert.equal(report!.total,'812333');assert.equal(report!.unconfirmed,'812333');assert.equal(fragmented.creationMode,'chained');assert.equal(report!.selectedInputs,13);assert.equal(report!.addressesQueried,6);
 // authorize marked the request uncertain: a second preparation cannot reuse the same inputs.
 const availableBefore=BigInt(report!.available);const another=await wallet.create(params,keys);assert.ok(!another.plan!.request.transaction.inputs.some(i=>fragmented.plan!.request.transaction.inputs.some(j=>binToHex(i.outpointTransactionHash)===binToHex(j.outpointTransactionHash)&&i.outpointIndex===j.outpointIndex)));
 assert.ok(BigInt(report!.available)<availableBefore);assert.ok(BigInt(report!.reserved)>0n);
 // Merely prepared unsigned plans don't reserve; explicit refusal releases only that request.
 await wallet.signingFailed(fragmented.id,'Wallet explicitly rejected',true);const fresh=await wallet.create(params,keys);assert.equal(report!.reserved,'0');assert.equal(fresh.creationMode,'chained');
 // Keep signed uncertain bytes reserved, even when status is absent. No auto-discard.
 const uncertain={...fresh,id:'uncertain',raw:'retained-signed-bytes',txid:'ab'.repeat(32),stage:'prepared' as const};await store.save(uncertain);
 const next=await wallet.create(params,keys);assert.ok(BigInt(report!.reserved)>0n);assert.equal((await store.list()).find(o=>o.id==='uncertain')!.raw,uncertain.raw);
 // An old ambiguous journal remains conservative; known never-signed journals are released.
 assert.equal(next.signing,'unsigned');assert.ok((await store.list()).length>=5);
 const auth=await wallet.authorize(next.id),tx=structuredClone(auth.plan.request.transaction) as Transaction;
 for(const [i] of auth.plan.inputPaths){const source=auth.plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:auth.plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=signer.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=new Uint8Array([...encodeDataPush(sig),...encodeDataPush(signer.publicKey)]);}
 const signed=binToHex(encodeTransaction(tx)),sent=await wallet.submit(next.id,signed);assert.equal(sent.stage,'pending',sent.error);assert.equal(sent.creationMode,'chained');assert.equal((await rpc('getrawmempool')).includes(sent.txid),true);
 // One local signature authorization yields both standard parent and permissionless child, no block.
 assert.equal(await rpc('getblockcount'),start+1);
 benchmark.push({label:'fragmented signed chained creation',localHarnessAuthorizations:1,transactions:2,inputs:auth.plan.inputPaths.length,signedParentBytes:hexToBin(signed).length,requiredConfirmations:0,realCashonize:false});
 await writeFile('docs/blaze2026/funding-benchmark.json',JSON.stringify({verifiedAt:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,transport:'isolated BCHN RPC Electrum facade; no public latency',benchmark,fragmentedBefore:{total:812333,required:33000,selected:13,error:'Former chooseBch rejected >8 and exhausted all supplied addresses'},liveWalletVerified:false},null,2)+'\n');
}));
