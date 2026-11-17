import {ownedOffers} from '../src/v3/my-offers.js';
import {remainingCommitment} from '../src/registry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {rpc,assertRegtest} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer,type Config} from '../src/v3/indexer.js';
import {RewardClaimer,type ClaimRecord,type ClaimStore} from '../src/v3/claim.js';
import {family,covenant,ownerAddress,buffer,type Parameters} from '../src/v3/protocol.js';
import {TokenRegtestProvider} from '../src/token-provider.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';
import {writeFile} from 'node:fs/promises';
test('My Offers: owner-approved cancellation recovery and full stake withdrawal with canonical confirmation',{timeout:900000},async()=>{
 await assertRegtest();const start=await rpc<number>('getblockcount'),key=new SignatureTemplate(new Uint8Array(32).fill(85)),keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}];
 class Local extends RegtestElectrum {
  loseAcknowledgement=false;broadcasts=0;
  override async sendRawTransaction(raw:string){this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Lost acknowledgement after acceptance');}return id;}
  // Deliberately advanced mocktime is test input. Header linkage/proofs still use real BCHN.
  override async tip(){return this.header(await rpc('getblockcount'));}
 }
 const provider=new Local(start),miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);provider.headerCache.clear();await provider.refresh();}
 const owner=ownerAddress(key.publicKey,provider);
 await rpc('sendtoaddress',[owner,0.01]);await mine();
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},wallet=new AssetWallet(provider,store);
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;
  for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i],preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i].unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function finish(op:Operation){assert.equal(op.stage,'review');await wallet.authorize(op.id);op=await wallet.submit(op.id,sign(op.plan!));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);assert.equal(op.step,'action');await wallet.authorize(op.id);op=await wallet.submit(op.id,sign(op.plan!));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);assert.equal(op.step,'complete');return op;}
 const mtp=(await rpc('getblockchaininfo')).mediantime,p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:mtp-1000,periodSeconds:100,periods:4,cap:2000n};
 const created=await finish(await wallet.createLegacy(p,keys)),config=created.config as Config;
 const empty=await new AssetIndexer(provider,config).sync();assert.equal(empty.instance.state[5],0);assert.equal(buffer(config,empty.instance.state,empty.clock.mtp-1),8000n);
 // New single-win offers leave the active queue after one full reward payment.
 const legacy=await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys);
 await store.save(legacy);await finish(await wallet.resume(legacy.id));
 assert.equal(ownedOffers(await new AssetIndexer(provider,config).sync(),keys[0]!.publicKey)[0]!.status,'ACTIVE');
 // Separate active commitment survives an interrupted cancellation workflow.
 await finish(await wallet.offer(config,{stake:3000n,duration:512,reward:2000n,maxWins:1},keys));
 const index=new AssetIndexer(provider,config),snap=await index.sync(),cs=family(config,snap.instance.category,provider),sponsor=covenant('FeeSponsorV3',[hexToBin(cs.registry.lockingBytecode)],provider);
 await rpc('sendtoaddress',[sponsor.address,0.0001]);await mine();
 const claims=new Map<string,ClaimRecord>(),claimStore:ClaimStore={list:async()=>[...claims.values()],save:async c=>{claims.set(c.id,structuredClone(c));}},claimer=new RewardClaimer(index,claimStore);
 const inspected=await claimer.inspect();assert.equal(inspected.next.phase,'ready');assert.ok(inspected.sponsor);
 // A journal failure must prevent broadcast entirely.
 const broken=new RewardClaimer(index,{list:claimStore.list,save:async()=>{throw Error('Disk quota');}});const beforeBroadcast=provider.broadcasts;await assert.rejects(()=>broken.claim(),/quota/);assert.equal(provider.broadcasts,beforeBroadcast);
 provider.loseAcknowledgement=true;const claimed=await claimer.claim();assert.equal(claimed.status,'prepared');assert.ok(claims.get(claimed.id)?.raw);assert.equal(provider.broadcasts,beforeBroadcast+1);assert.equal((await index.sync()).pendingHistory?.[0],claimed.id);assert.equal((await new RewardClaimer(new AssetIndexer(provider,config),claimStore).reconcile(claimed.id)).status,'pending');assert.equal(provider.broadcasts,beforeBroadcast+1);
 await mine();const confirmed=await claimer.reconcile(claimed.id);assert.equal(confirmed.status,'confirmed');const locked=await index.sync();assert.equal(locked.allocations.length,1);assert.equal(locked.allocations[0]!.mature,false);
 // Move the actual winning block out of the canonical chain, then replay it as pending.
 const tx=await rpc('getrawtransaction',[claimed.id,true]);await rpc('invalidateblock',[tx.blockhash]);provider.headerCache.clear();await provider.refresh();const rolled=await index.sync();assert.equal(rolled.allocations.length,1);assert.equal(rolled.allocations[0]!.mature,false);assert.equal(rolled.instance.state[6+46],1);assert.equal((await claimer.reconcile(claimed.id)).status,'pending');await rpc('reconsiderblock',[tx.blockhash]);provider.headerCache.clear();await provider.refresh();assert.equal((await index.sync()).allocations.length,1);
 await assert.rejects(()=>wallet.withdraw(config,locked.allocations[0]!.id,keys),/immature/);
 await assert.rejects(()=>wallet.action(config,1,0,keys),/active/);
 assert.equal(ownedOffers(await index.sync(),keys[0]!.publicKey)[0]!.status,'WON / LOCKED');
 await finish(await wallet.action(config,1,1,keys));
 const interrupted=await new AssetIndexer(provider,config).sync();
 assert.equal(ownedOffers(interrupted,keys[0]!.publicKey)[1]!.recovery,true);
 assert.equal(remainingCommitment(interrupted.instance.state),3000n);
 // Reconstruct the worker with the retained journal; no signed bytes are discarded.
 const restarted=new AssetWallet(provider,store);
 await finish(await restarted.action(config,4,1,keys));
 const recovered=await index.sync();assert.equal(remainingCommitment(recovered.instance.state),0n);
 assert.equal(ownedOffers(recovered,keys[0]!.publicKey)[1]!.status,'CANCELLED');
 assert.ok(recovered.offerHistory?.some(h=>h.slot===1&&h.action===4&&!h.pending));
 const target=(await rpc('getblockchaininfo')).mediantime+1200;await rpc('setmocktime',[target]);await rpc('generatetoaddress',[11,miner]);provider.headerCache.clear();await provider.refresh();const mature=await index.sync();assert.equal(mature.allocations[0]!.mature,true);assert.equal(ownedOffers(mature,keys[0]!.publicKey)[0]!.status,'BAKED');
 let withdrawal=await wallet.withdraw(config,mature.allocations[0]!.id,keys);
 await wallet.authorize(withdrawal.id);withdrawal=await wallet.submit(withdrawal.id,sign(withdrawal.plan!));await mine();withdrawal=await wallet.resume(withdrawal.id);
 assert.equal(withdrawal.plan!.fee,'10000');assert.equal(withdrawal.plan!.signers[0],keys[0]!.publicKey);
 const output=(withdrawal.plan!.request.transaction as Transaction).outputs[0]!;assert.equal(output.valueSatoshis,3000n);
 await wallet.authorize(withdrawal.id);withdrawal=await wallet.submit(withdrawal.id,sign(withdrawal.plan!));
 assert.equal(ownedOffers(await index.sync(),keys[0]!.publicKey)[0]!.status,'BAKED');
 await mine();withdrawal=await wallet.resume(withdrawal.id);assert.equal(withdrawal.step,'complete');
 assert.equal(ownedOffers(await index.sync(),keys[0]!.publicKey)[0]!.status,'FINISHED');
 await writeFile('docs/blaze2026/my-offers/native-results.json',JSON.stringify({network:'regtest',node:(await rpc('getnetworkinfo')).subversion,verifiedAt:new Date().toISOString(),genesis:config.genesis,claim:claimed.id,walletPlansSignedLocally:true,publicWalletVerified:false,publicClaimWithoutWallet:true,interruptedAcknowledgementVerified:true,reorganizationReplayVerified:true,relativeWithdrawalVerified:true},null,2)+'\n');
});
