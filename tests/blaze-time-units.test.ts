import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,allocationSequence,decision,type Parameters} from '../src/v3/protocol.js';
import {stakingUnitsToSeconds} from '../src/v3/time-policy.js';
import {releaseDisplay} from '../src/v3/release-display.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';

test('whole-unit staking: new atomic vault, reviewed offers, claims, recovery and independent CSV withdrawals',{timeout:300000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {
  override async tip(){return this.header(await rpc('getblockcount'));}
  override async sendRawTransaction(raw:string){
   const [valid]=await rpc('testmempoolaccept',[[raw]]);assert.equal(valid.allowed,true,JSON.stringify(valid));
   const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;
  }
 }
 const provider=new Local(await rpc('getblockcount')),key=new SignatureTemplate(new Uint8Array(32).fill(231));
 const keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}],owner=ownerAddress(key.publicKey,provider),miner=await rpc<string>('getnewaddress');
 const rows=new Map<string,Operation>(),store={list:async()=>structuredClone([...rows.values()]),save:async(o:Operation)=>{rows.set(o.id,structuredClone(o));}};
 let wallet=new AssetWallet(provider,store);
 const mine=async()=>{await rpc('generatetoaddress',[1,miner]);provider.headerCache.clear();await provider.refresh();};
 const sign=(plan:BrowserPlan)=>{
  const tx=structuredClone(plan.request.transaction) as Transaction;
  for(const [i]of plan.inputPaths){
   const source=plan.request.sourceOutputs[i]!,sig=key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));
   sig[64]=0x61;
   tx.inputs[i]!.unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);
  }
  return binToHex(encodeTransaction(tx));
 };
 const finish=async(op:Operation)=>{
  for(let i=0;i<3&&op.step!=='complete';i++){
   const authorized=await wallet.authorize(op.id);
   op=await wallet.submit(op.id,sign(authorized.plan!));assert.equal(op.stage,'pending',op.error);
   // Recreate the engine using the same journal before reconciliation.
   wallet=new AssetWallet(provider,store);await mine();op=await wallet.resume(op.id);
  }
  assert.equal(op.step,'complete',op.error);return op;
 };
 // Guaranteed genesis-capable output zero, independent of node wallet coin selection.
 const raw=await rpc('createrawtransaction',[[],{[owner]:0.1}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]);
 await rpc('sendrawtransaction',[signed.hex]);await mine();
 const mtp=(await rpc('getblockchaininfo')).mediantime;
 const params:Parameters={version:3,registryVersion:4,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:mtp-2400,periodSeconds:600,periods:4,cap:2000n};
 console.log('Creating new atomic vault');
 const created=await finish(await wallet.create(params,keys)),config=created.config!;
 const index=new AssetIndexer(provider,config),empty=await index.sync(),stamp=Date.now();
 assert.equal(releaseDisplay(config,empty.instance.state,empty.clock.mtp,stamp,stamp,true).available,decision(empty.instance,empty.clock).available);
 console.log('Registering 12-unit and 1-unit offers');
 for(const units of [12,1]){
  const op=await wallet.offer(config,{stake:3000n,duration:stakingUnitsToSeconds(units),reward:1000n,maxWins:1},keys);
  assert.match(op.plan!.label,new RegExp('Lock duration: '+units+' time unit'));
  await finish(op);
 }
 console.log('Claiming both rewards');
 await finish(await wallet.claim(config,keys));await finish(await wallet.claim(config,keys));
 const locked=await index.sync();assert.equal(locked.allocations.length,2);
 const long=locked.allocations.find(a=>(Buffer.from(a.terms).readUInt32LE(74)&65535)===12)!;
 const short=locked.allocations.find(a=>(Buffer.from(a.terms).readUInt32LE(74)&65535)===1)!;
 assert.ok(long);assert.ok(short);assert.equal(long.mature,false);assert.equal(short.mature,false);
 await assert.rejects(()=>wallet.withdraw(config,short.id,keys),/immature/);
 const target=short.sourceMtp+512;await rpc('setmocktime',[target]);await rpc('generatetoaddress',[11,miner]);provider.headerCache.clear();await provider.refresh();
 const partly=await index.sync();assert.equal(partly.allocations.find(a=>a.id===short.id)!.mature,true);assert.equal(partly.allocations.find(a=>a.id===long.id)!.mature,false);
 const other:WalletKey[]=[{...keys[0]!,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(232)).publicKey)}];
 await assert.rejects(()=>wallet.withdraw(config,short.id,other),/not owned/);
 console.log('Withdrawing short allocation while long allocation stays locked');
 const withdrawn=await finish(await wallet.withdraw(config,short.id,keys));
 const withdrawalTx=withdrawn.plan!.request.transaction as Transaction;
 assert.equal(withdrawalTx.inputs[0]!.sequenceNumber,allocationSequence(512));
 assert.equal(withdrawalTx.outputs[0]!.valueSatoshis,3000n);
 const independentlyLocked=await index.sync();assert.ok(independentlyLocked.allocations.find(a=>a.id===short.id)!.withdrawal);assert.equal(independentlyLocked.allocations.find(a=>a.id===long.id)!.mature,false);
 await rpc('setmocktime',[long.sourceMtp+6144]);await rpc('generatetoaddress',[11,miner]);provider.headerCache.clear();await provider.refresh();
 console.log('Withdrawing long allocation at its independent maturity');
 const final=await finish(await wallet.withdraw(config,long.id,keys));
 assert.equal((final.plan!.request.transaction as Transaction).inputs[0]!.sequenceNumber,allocationSequence(6144));
 assert.equal((await index.sync()).allocations.filter(a=>a.withdrawal).length,2);
},18558));
