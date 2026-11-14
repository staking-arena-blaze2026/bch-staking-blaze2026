import {legacyTwoWinJournal} from './fixtures/v3-legacy-offer.js';
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
test('v3 local BCHN browser wallet plans, canonical replay, public sponsor, interrupted claims and reorg recovery',{timeout:900000},async()=>{
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
 async function finish(op:Operation){assert.equal(op.stage,'review');await wallet.authorize(op.id);op=await wallet.submit(op.id,sign(op.plan!));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);assert.equal(op.step,'action');op=await wallet.submit(op.id,sign(op.plan!));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);assert.equal(op.step,'complete');return op;}
 const mtp=(await rpc('getblockchaininfo')).mediantime,p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:mtp-1000,periodSeconds:100,periods:4,cap:2000n};
 const created=await finish(await wallet.createLegacy(p,keys)),config=created.config as Config;
 const empty=await new AssetIndexer(provider,config).sync();assert.equal(empty.instance.state[5],0);assert.equal(buffer(config,empty.instance.state,empty.clock.mtp-1),8000n);
 // A pending pre-upgrade W=2 journal must finish with its original collateral.
 const legacy=legacyTwoWinJournal(await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys));
 await store.save(legacy);await finish(await wallet.resume(legacy.id));
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
 await finish(await wallet.action(config,1,0,keys));await finish(await wallet.action(config,4,0,keys));assert.equal((await index.sync()).allocations.length,1);
 const target=(await rpc('getblockchaininfo')).mediantime+1200;await rpc('setmocktime',[target]);await rpc('generatetoaddress',[11,miner]);provider.headerCache.clear();await provider.refresh();const mature=await index.sync();assert.equal(mature.allocations[0]!.mature,true);await finish(await wallet.withdraw(config,mature.allocations[0]!.id,keys));assert.ok((await index.sync()).allocations[0]!.withdrawal);
 await writeFile('docs/staking-arena-v3-browser-results.json',JSON.stringify({network:'regtest',node:(await rpc('getnetworkinfo')).subversion,verifiedAt:new Date().toISOString(),genesis:config.genesis,claim:claimed.id,walletPlansSignedLocally:true,publicWalletVerified:false,publicClaimWithoutWallet:true,interruptedAcknowledgementVerified:true,reorganizationReplayVerified:true,relativeWithdrawalVerified:true},null,2)+'\n');
});
