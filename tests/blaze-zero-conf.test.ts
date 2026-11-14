import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {utxo} from '../src/arena-core.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,directGenesisBuilder,type Parameters,type Asset} from '../src/v3/protocol.js';
import {scanWallet,chooseBch,verifyCoinsAcrossPeers} from '../src/electrum-wallet.js';
import type {WalletKey,BrowserPlan} from '../src/transactions-core.js';

test('isolated BCHN 29.2: direct genesis and dependent offers/claim without blocks',{timeout:900000},async()=>isolatedRegtest(async({restartWithoutMempool})=>{
 const start=await rpc<number>('getblockcount');
 class Local extends RegtestElectrum {
  requests=0;broadcasts=0;loseAcknowledgement=false;
  override async sendRawTransaction(raw:string){const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Lost acknowledgement');}return id;}
 }
 const p=new Local(start),request=p.request;p.request=async(...args)=>{p.requests++;return request(...args);};
 const key=new SignatureTemplate(new Uint8Array(32).fill(250)),owner=ownerAddress(key.publicKey,p),keys:WalletKey[]=Array.from({length:40},(_,index)=>(['receive','change','defi'] as const).map(path=>({path,index,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(index===0&&path==='receive'?250:10+index*3+(['receive','change','defi'].indexOf(path)))).publicKey)}))).flat();
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}};
 let discovery={addresses:0,milliseconds:0,requests:0};let discoveryStart=0,discoveryRequests=0;
 const wallet=new AssetWallet(p,store,message=>{if(message==='Finding wallet funds…'){discoveryStart=performance.now();discoveryRequests=p.requests;}const match=message.match(/Funding discovery: (\d+) addresses/);if(match)discovery={addresses:Number(match[1]),milliseconds:performance.now()-discoveryStart,requests:p.requests-discoveryRequests};});let approvals=0;
 function sign(plan:BrowserPlan){approvals++;const tx=structuredClone(plan.request.transaction) as Transaction;
  for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function approve(op:Operation):Promise<Operation>{const auth=await wallet.authorize(op.id);const sent=await wallet.submit(op.id,sign(auth.plan!));assert.equal(sent.stage,'pending',sent.error);return sent;}
 const miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();}
 // sendmany produces multiple eligible wallet outputs, with a guaranteed genesis output at zero.
 async function fund(){const id=await rpc<string>('sendtoaddress',[owner,0.02]);await p.refresh();const raw=await rpc('getrawtransaction',[id,true]);return {id,vout:raw.vout.findIndex((o:any)=>o.scriptPubKey.addresses?.includes(owner)||o.scriptPubKey.address===owner)};}
 await fund();await mine();
 const clock=(await rpc('getblockchaininfo')).mediantime,params:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:clock-1000,periodSeconds:100,periods:4,cap:2000n};
 // BCHN randomized change position is normalized using a wallet-signed self-transfer.
 async function outputZero(){
  const raw=await rpc('createrawtransaction',[[],{[owner]:0.015}]);const funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]);const signed=await rpc('signrawtransactionwithwallet',[funded.hex]);const id=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();return id;
 }
 await outputZero();await mine();
 const beforeRequests=p.requests,t0=performance.now();const baseline=await scanWallet(p,keys);const before={addresses:baseline.addresses,requests:p.requests-beforeRequests,milliseconds:performance.now()-t0,untilSigning:{requests:0,milliseconds:0},transactions:1,authorizations:1};
 const genesis=baseline.coins.filter(c=>c.utxo.vout===0&&!c.utxo.token).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)[0]!,selected=chooseBch(baseline.coins,21000n,[genesis]);
 directGenesisBuilder(params,selected,genesis,p).builder.generateWcTransactionObject({broadcast:false});await verifyCoinsAcrossPeers(p,selected.map(c=>c.utxo));await verifyCoinsAcrossPeers(p,selected.map(c=>c.utxo));before.untilSigning={requests:p.requests-beforeRequests,milliseconds:performance.now()-t0};
 const req=p.requests,t1=performance.now(),a0=approvals,b0=p.broadcasts;const prepared=await wallet.create(params,keys),auth=await wallet.authorize(prepared.id);
 const untilSigning={requests:p.requests-req,milliseconds:performance.now()-t1};const created=await wallet.submit(prepared.id,sign(auth.plan));assert.equal(created.stage,'pending',created.error);
 const after={...discovery,untilSigning,transactions:p.broadcasts-b0,authorizations:approvals-a0};
 assert.equal(after.authorizations,1);assert.equal(after.transactions,1);assert.equal(created.plan!.request.transaction.inputs[0]!.outpointIndex,0);
 const config=created.config!,snap=await new AssetIndexer(p,config).sync();assert.equal(snap.provisional,true);assert.equal(snap.instance.category,binToHex(created.plan!.request.transaction.inputs[0]!.outpointTransactionHash));
 // Creation's wallet change can sponsor all following stages without mining.
 let offer=await approve(await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys));
 offer=await wallet.resume(offer.id);assert.equal(offer.step,'action');offer=await approve(offer);
 const offered=await new AssetIndexer(p,config).sync();assert.equal(offered.instance.state[5],1);assert.equal(offered.provisional,true);
 const claim=await approve(await wallet.claim(config,keys));assert.equal((await wallet.resume(claim.id)).stage,'pending');const claimed=await new AssetIndexer(p,config).sync();assert.equal(claimed.allocations.length,1);assert.equal(claimed.allocations[0]!.mature,false);
 assert.equal(await rpc('getblockcount'),start+2);
 const all=await p.getUtxos(owner),self=new TransactionBuilder({provider:p});for(const coin of all.filter(c=>!c.token))self.addInput(coin,key.unlockP2PKH());self.addOutput({to:owner,amount:all.filter(c=>!c.token).reduce((n,c)=>n+c.satoshis,0n)-10000n});
 const unconfirmedParent=await rpc<string>('sendrawtransaction',[self.build()]);await p.refresh();const a1=approvals;
 const pendingCreated=await approve(await wallet.create({...params,cap:2100n},keys));assert.equal(approvals-a1,1);assert.equal(pendingCreated.plan!.request.transaction.inputs[0]!.outpointIndex,0);
 assert.equal(binToHex(pendingCreated.plan!.request.transaction.inputs[0]!.outpointTransactionHash),unconfirmedParent);assert.ok((await rpc<string[]>('getrawmempool')).includes(unconfirmedParent));
 const parentTx=await p.transactionStatus(unconfirmedParent),conflict=new TransactionBuilder({provider:p});let conflictTotal=0n;for(const input of parentTx.vin){const source=utxo(await p.transactionStatus(input.txid),input.vout);conflictTotal+=source.satoshis;conflict.addInput(source,key.unlockP2PKH());}conflict.addOutput({to:owner,amount:conflictTotal-10001n});const conflictRaw=conflict.build(),conflictId=(await import('../src/electrum-core.js')).decodeRawTransaction(conflictRaw).txid;
 const [conflictAcceptance]=await rpc('testmempoolaccept',[[conflictRaw]]);assert.equal(conflictAcceptance.allowed,false);p.extra.set(conflictId,conflictRaw);await p.refresh();await assert.rejects(()=>new AssetIndexer(p,pendingCreated.config!).sync(),/double-spend conflict/);p.extra.delete(conflictId);await p.refresh();
 // Without a wallet-owned vout=0, Create Vault uses the covenant-controlled chain: two txs, one approval.
 const burner=await rpc<string>('getnewaddress');
 const zeros=(await p.getUtxos(owner)).filter(u=>u.vout===0&&!u.token);
 if(zeros.length){const b=new TransactionBuilder({provider:p});let total=0n;for(const c of zeros){b.addInput(c,key.unlockP2PKH());total+=c.satoshis;}b.addOutput({to:burner,amount:1000n}).addOutput({to:owner,amount:total-11000n});await rpc('sendrawtransaction',[b.build()]);await p.refresh();}
 const a2=approvals,b2=p.broadcasts,chained=await approve(await wallet.create({...params,cap:2200n},keys));
 assert.equal(chained.creationMode,'chained');assert.equal(approvals-a2,1);assert.equal(p.broadcasts-b2,2);
 assert.ok((await new AssetIndexer(p,chained.config!).sync()).provisional);
 // Legacy two-approval factory path remains available explicitly.
 const a3=approvals,legacy1=await approve(await wallet.createLegacy({...params,cap:2300n},keys));let legacy2=await wallet.resume(legacy1.id);assert.equal(legacy2.step,'action');legacy2=await approve(legacy2);assert.equal(approvals-a3,2);assert.ok((await new AssetIndexer(p,legacy2.config??{...params,cap:2300n,genesis:legacy2.txid!}).sync()).provisional);
 const fallbackAuthorizations=approvals-a3;
 const tokenAssets:Asset[]=[],nfts:string[]=[];
 for(let i=0;i<2;i++){
  const seed=await outputZero(),source=utxo(await p.transactionStatus(seed),0);
  const mint=new TransactionBuilder({provider:p}).addInput(source,key.unlockP2PKH()).addOutput({to:owner,amount:source.satoshis-11000n,token:{category:seed,amount:100000n}}).addOutput({to:owner,amount:1000n,token:{category:seed,amount:0n,nft:{capability:'none',commitment:'12'}}});
  nfts.push(await rpc<string>('sendrawtransaction',[mint.build()]));await p.refresh();tokenAssets.push({kind:'token',category:seed});
 }
 await mine();const bch:Asset={kind:'bch'},combinations=[{staking:'bch',reward:'bch',sameCategory:false,genesis:created.txid,claim:claim.txid,authorizations:4,transactions:4}];
 for(const [stakingAsset,rewardAsset]of [[bch,tokenAssets[0]!],[tokenAssets[0]!,bch],[tokenAssets[0]!,tokenAssets[1]!],[tokenAssets[0]!,tokenAssets[0]!]] as [Asset,Asset][]){
  console.log('0-conf asset pair',stakingAsset.kind,rewardAsset.kind);await outputZero();const a=approvals,b=p.broadcasts;
  const flowHeight=await rpc('getblockcount');const vault=await approve(await wallet.create({...params,stakingAsset,rewardAsset},keys));assert.equal(approvals-a,1);assert.equal(p.broadcasts-b,1);
  let offer=await approve(await wallet.offer(vault.config!,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys));offer=await approve(await wallet.resume(offer.id));
  const reward=await approve(await wallet.claim(vault.config!,keys)),state=await new AssetIndexer(p,vault.config!).sync();assert.equal(state.allocations.length,1);assert.equal(state.provisional,true);assert.equal(state.instance.state[5],1);
  for(const nft of nfts)assert.ok(await rpc('gettxout',[nft,1,true]),'Unrelated NFT remains spendable');
  assert.equal(await rpc('getblockcount'),flowHeight);combinations.push({staking:stakingAsset.kind,reward:rewardAsset.kind,sameCategory:stakingAsset.kind==='token'&&rewardAsset.kind==='token'&&stakingAsset.category===rewardAsset.category,genesis:vault.txid!,claim:reward.txid!,authorizations:approvals-a,transactions:p.broadcasts-b});await mine();
 }
 // Refusal, journal durability, metadata substitution and lost acknowledgements.
 await outputZero();let recovery=await wallet.create({...params,cap:2350n},keys);const broadcasts=p.broadcasts;
 await wallet.signingFailed(recovery.id,'User rejected');assert.equal(p.broadcasts,broadcasts);assert.equal(journal.get(recovery.id)!.raw,undefined);
 const clean=structuredClone(journal.get(recovery.id)!);journal.get(recovery.id)!.plan!.request.broadcast=true;await assert.rejects(()=>wallet.authorize(recovery.id),/disable wallet broadcasting/);journal.set(recovery.id,structuredClone(clean));
 journal.get(recovery.id)!.plan!.request.transaction.outputs[2]!.valueSatoshis--;await assert.rejects(()=>wallet.authorize(recovery.id),/Saved genesis/);journal.set(recovery.id,structuredClone(clean));
 const authorized=await wallet.authorize(recovery.id),signed=sign(authorized.plan),broken=new AssetWallet(p,{list:store.list,save:async()=>{throw Error('Quota');}});await assert.rejects(()=>broken.submit(recovery.id,signed),/Quota/);assert.equal(p.broadcasts,broadcasts);
 p.loseAcknowledgement=true;recovery=await wallet.submit(recovery.id,signed);assert.equal(recovery.stage,'prepared');assert.equal(p.broadcasts,broadcasts+1);const bytes=recovery.raw;
 const reopened=new AssetWallet(p,store);assert.equal((await reopened.resume(recovery.id)).stage,'pending');assert.equal(p.broadcasts,broadcasts+1);
 const parent=binToHex(recovery.plan!.request.transaction.inputs[0]!.outpointTransactionHash);p.hidden.add(parent);await assert.rejects(()=>new AssetIndexer(p,recovery.config!).sync(),/unavailable/);p.hidden.delete(parent);
 p.hidden.add(recovery.txid!);assert.equal((await reopened.resume(recovery.id)).stage,'prepared');assert.equal(journal.get(recovery.id)!.raw,bytes);p.hidden.delete(recovery.txid!);assert.equal((await reopened.resume(recovery.id)).stage,'pending');
 p.disagree=true;await assert.rejects(()=>new AssetIndexer(p,recovery.config!).sync());p.disagree=false;
 // Mine only after all 0-conf paths finished, then remove/reconsider that block.
 await mine();assert.equal((await reopened.resume(recovery.id)).stage,'confirmed');const block=await rpc('getbestblockhash');await rpc('invalidateblock',[block]);p.headerCache.clear();await p.refresh();assert.equal((await reopened.resume(recovery.id)).stage,'pending');assert.equal((await new AssetIndexer(p,recovery.config!).sync()).provisional,true);
 await rpc('reconsiderblock',[block]);p.headerCache.clear();await p.refresh();assert.equal((await reopened.resume(recovery.id)).stage,'confirmed');
 const evictParent=await approve(await wallet.createLegacy({...params,cap:2400n},keys)),evictChild=await approve(await wallet.resume(evictParent.id)),evictBroadcasts=p.broadcasts;await restartWithoutMempool();p.headerCache.clear();await p.refresh();assert.deepEqual(await rpc('getrawmempool'),[]);assert.equal((await reopened.resume(evictChild.id)).stage,'prepared');assert.equal(p.broadcasts,evictBroadcasts);assert.equal(journal.get(evictChild.id)!.raw,evictChild.raw);
 await reopened.rebroadcastFunding(evictChild.id);const restored=await reopened.rebroadcast(evictChild.id);assert.equal(restored.stage,'pending',restored.error);assert.equal((await new AssetIndexer(p,restored.config!).sync()).provisional,true);
 await writeFile('docs/blaze2026/zero-conf-results.json',JSON.stringify({node:(await rpc('getnetworkinfo')).subversion,verifiedAt:new Date().toISOString(),before,after,benchmarkTransport:'local Electrum facade over isolated BCHN RPC; no public latency',localSignatureHarness:true,realCashonizePromptsTested:false,confirmedZero:true,unconfirmedZero:true,zeroConfCreationOfferClaim:true,chainedAuthorizations:1,chainedTransactions:2,fallbackAuthorizations,packageAuthorizationSupported:false,combinations,rejection:true,journalFailure:true,lostAcknowledgement:true,missingParent:true,knownConflict:true,actualParentEvictionAndIdenticalRecovery:true,providerDisagreement:true,reorganization:true,genesis:config.genesis,claim:claim.txid,chainedGenesis:chained.txid},null,2)+'\n');
}));
