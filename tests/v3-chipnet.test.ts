import {legacyTwoWinJournal} from './fixtures/v3-legacy-offer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Network,SignatureTemplate,MockNetworkProvider} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {v3BrowserChain} from './fixtures/v3-browser-chain.js';
import {AssetWallet,BrowserAssetStore,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {BrowserClaimStore} from '../src/v3/claim.js';
import {v3Network,v3Storage} from '../src/v3/network.js';
import {covenant,ownerAddress,parameterArgs,type Parameters,type Asset} from '../src/v3/protocol.js';
import {walletScript,type BrowserPlan,type WalletKey} from '../src/transactions-core.js';
import {ElectrumCore} from '../src/electrum-core.js';

test('v3 network guards, isolated journals and identical covenant scripts',()=>{
 const p=new MockNetworkProvider(),q=new MockNetworkProvider();p.network=Network.REGTEST;q.network=Network.CHIPNET;
 const args=parameterArgs({version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1700000000,periodSeconds:60,periods:2,cap:2000n});
 assert.equal(covenant('RegistryGenesisV3',args,p).lockingBytecode,covenant('RegistryGenesisV3',args,q).lockingBytecode);
 const key=new SignatureTemplate(new Uint8Array(32).fill(4));assert.match(ownerAddress(key.publicKey,p),/^bchreg:/);assert.match(ownerAddress(key.publicKey,q),/^bchtest:/);
 for(const kind of ['wallet','claims','configs'] as const){assert.notEqual(v3Storage(kind,'chipnet'),v3Storage(kind,'regtest'));}
 assert.equal(new BrowserAssetStore('chipnet').network,'chipnet');assert.equal(new BrowserClaimStore('regtest').network,'regtest');
 for(const network of [Network.TESTNET3,Network.TESTNET4]){q.network=network;assert.throws(()=>v3Network(q));assert.throws(()=>covenant('RegistryGenesisV3',args,q));assert.throws(()=>ownerAddress(key.publicKey,q));assert.throws(()=>new AssetWallet(q as any,{} as Store));assert.throws(()=>new AssetIndexer(q as any,{} as any));}
 assert.equal(new ElectrumCore(()=>{throw Error('unused');},{network:'mainnet'}).network,Network.MAINNET);
});

function sign(plan:BrowserPlan,key:SignatureTemplate){
 const tx=structuredClone(plan.request.transaction) as Transaction;
 for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode!).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
 return binToHex(encodeTransaction(tx));
}
for(const pair of ['bch-bch','bch-token','token-bch','token-token'])test(`chipnet ${pair}: direct genesis, one creation approval, registration, caller claim, cancellation/refund and maturity`,async()=>{
 const f=v3BrowserChain(Network.CHIPNET),provider=f.chain.provider(),key=f.key,keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}],journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},wallet=new AssetWallet(provider,store);
 const bch:Asset={kind:'bch'},token:Asset={kind:'token',category:'ac'.repeat(32)},[s,r]=pair.split('-'),p:Parameters={version:3,stakingAsset:s==='bch'?bch:token,rewardAsset:r==='bch'?bch:token,epoch:f.chain.clock().mtp-1000,periodSeconds:60,periods:4,cap:2000n};
 f.coin(1000000n);
 f.add(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin('ab'.repeat(32)),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:1000n,lockingBytecode:hexToBin(walletScript(keys[0]!.publicKey)),token:{category:hexToBin(token.category),amount:100000n}}]})));
 async function approve(op:Operation,signer=key){const {plan}=await wallet.authorize(op.id);assert.equal(plan.request.broadcast,false);assert.equal(plan.fee,'10000');assert.match(plan.request.userPrompt!,/CHIPNET/);return wallet.submit(op.id,sign(plan,signer));}
 async function finish(op:Operation){if(op.creationMode==='direct'){op=await approve(op);assert.equal(op.stage,'pending',op.error);f.chain.mine();return wallet.resume(op.id);}assert.equal(op.step,'funding');op=await approve(op);assert.equal(op.stage,'pending');f.chain.mine();op=await wallet.resume(op.id);assert.equal(op.step,'action');op=await approve(op);assert.equal(op.stage,'pending',op.error);f.chain.mine();return wallet.resume(op.id);}
 let creation=await wallet.create(p,keys);const original=structuredClone(journal.get(creation.id)!);journal.get(creation.id)!.plan!.request.broadcast=true;await assert.rejects(()=>wallet.authorize(creation.id),/disable wallet broadcasting/);journal.set(creation.id,original);
 const created=await finish(creation);assert.equal(created.step,'complete');assert.equal(created.stage,'confirmed');const config=created.config!;
 const initial=await new AssetIndexer(provider,config).sync();assert.equal(initial.config.stakingAsset.kind,p.stakingAsset.kind);assert.equal(initial.config.rewardAsset.kind,p.rewardAsset.kind);assert.equal(initial.instance.inputs[2].token?.amount??initial.instance.inputs[2].satoshis-1000n,8000n);
 const legacy=legacyTwoWinJournal(await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys));
 await store.save(legacy);await finish(await wallet.resume(legacy.id));
 await assert.rejects(()=>wallet.offer(config,{stake:3000n,duration:513,reward:9000n,maxWins:1},keys),/reserve/);
 const caller=new SignatureTemplate(new Uint8Array(32).fill(95)),callerKeys:WalletKey[]=[{publicKey:binToHex(caller.publicKey),path:'receive',index:0}];f.coin(20000n,walletScript(callerKeys[0]!.publicKey));
 let claim=await wallet.claim(config,callerKeys);assert.deepEqual(claim.plan!.inputPaths,[[3,'receive',0]]);assert.equal(claim.plan!.request.sourceOutputs[3]!.token,undefined);const outputs=claim.plan!.request.transaction.outputs;
 assert.equal(outputs[3]!.token?.amount??outputs[3]!.valueSatoshis,2000n);const required=10000n+(s==='token'?1000n:0n)+(r==='token'?1000n:0n);assert.equal(outputs[5]!.valueSatoshis,20000n-required);
 claim=await approve(claim,caller);assert.equal(claim.stage,'pending');f.chain.mine();assert.equal((await wallet.resume(claim.id)).stage,'confirmed');
 const snapshot=await new AssetIndexer(provider,config).sync(),allocation=snapshot.allocations[0]!;assert.equal(allocation.mature,false);await assert.rejects(()=>wallet.withdraw(config,allocation.id,keys),/immature/);
 await finish(await wallet.action(config,1,0,keys));await finish(await wallet.action(config,4,0,keys));
 for(let i=0;i<30;i++)f.chain.mine([]);
 assert.equal((await new AssetIndexer(provider,config).sync()).allocations[0]!.mature,true);
 const withdrawal=await finish(await wallet.withdraw(config,allocation.id,keys));assert.equal(withdrawal.stage,'confirmed',withdrawal.error);assert.equal((await new AssetIndexer(provider,config).sync()).allocations[0]!.withdrawal,withdrawal.txid);
});

test('direct genesis retries saved bytes after drop and detects a canonical conflicting spend',async()=>{
 const f=v3BrowserChain(Network.CHIPNET),provider=f.chain.provider(),key=f.key,keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}];f.coin(1000000n);
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},wallet=new AssetWallet(provider,store);
 const op=await wallet.create(f.config,keys),authorized=await wallet.authorize(op.id),raw=sign(authorized.plan,key);
 const sent=await wallet.submit(op.id,raw);assert.equal(sent.stage,'pending');const id=sent.txid!;
 f.chain.pending.delete(id);f.chain.transactions.delete(id);
 const reloaded=new AssetWallet(provider,store);assert.equal((await reloaded.resume(op.id)).stage,'prepared');assert.equal(journal.get(op.id)!.raw,raw);
 const retried=await reloaded.rebroadcast(op.id);assert.equal(retried.stage,'pending');assert.equal(retried.raw,raw);assert.deepEqual(f.chain.broadcasts.slice(-2),[id,id]);
 // A competing spend is explicit test input, never a production replacement.
 f.chain.pending.delete(id);f.chain.transactions.delete(id);
 const conflicting=structuredClone(authorized.plan);conflicting.request.transaction.outputs[2]!.valueSatoshis--;
 const conflict=f.add(sign(conflicting,key));
 const blocked=await reloaded.resume(op.id);assert.equal(blocked.stage,'conflicted');assert.match(blocked.error!,new RegExp(conflict.txid));assert.equal(blocked.raw,raw);
 const broadcasts=f.chain.broadcasts.length;await assert.rejects(()=>reloaded.rebroadcast(op.id),/Input spent|Conflicting blockchain evidence/);assert.equal(f.chain.broadcasts.length,broadcasts);
});
