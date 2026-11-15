import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,decodeTransaction,createVirtualMachineBch2026,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {utxo,records,rankings} from '../src/arena-core.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,chainedChildBuilder,chainedPreparation,chainedGenesisRefundBuilder,chainedFundingRecoverBuilder,type Parameters,type Asset,FEE,CARRIER} from '../src/v3/protocol.js';
import type {WalletKey,BrowserPlan} from '../src/transactions-core.js';

test('isolated BCHN 29.2: direct atomic registration with one approval and one transaction',{timeout:900000},async()=>isolatedRegtest(async({restartWithoutMempool})=>{
 class Local extends RegtestElectrum {
  requests=0;broadcasts=0;loseAcknowledgement=false;
  override async sendRawTransaction(raw:string){const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Lost acknowledgement');}return id;}
 }
 const start=await rpc<number>('getblockcount'),p=new Local(start),request=p.request;p.request=async(...args)=>{p.requests++;return request(...args);};
 const key=new SignatureTemplate(new Uint8Array(32).fill(250)),owner=ownerAddress(key.publicKey,p);
 const keys:WalletKey[]=Array.from({length:40},(_,index)=>(['receive','change','defi'] as const).map(path=>({path,index,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(index===0&&path==='receive'?250:10+index*3+(['receive','change','defi'].indexOf(path)))).publicKey)}))).flat();
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}};
 let discovery={addresses:0,milliseconds:0,requests:0},discoveryStart=0,discoveryRequests=0;
 const wallet=new AssetWallet(p,store,message=>{if(message==='Finding wallet funds…'){discoveryStart=performance.now();discoveryRequests=p.requests;}const match=message.match(/Funding discovery: (\d+) addresses/);if(match)discovery={addresses:Number(match[1]),milliseconds:performance.now()-discoveryStart,requests:p.requests-discoveryRequests};});
 let approvals=0;
 function sign(plan:BrowserPlan){approvals++;const tx=structuredClone(plan.request.transaction) as Transaction;
  for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function approve(op:Operation){const auth=await wallet.authorize(op.id);const sent=await wallet.submit(op.id,sign(auth.plan!));assert.equal(sent.stage,'pending',sent.error);return sent;}
 const miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();}
 const burner=await rpc<string>('getnewaddress');
 async function fundWallet(bch=0.05){const id=await rpc<string>('sendtoaddress',[owner,bch]);await p.refresh();return id;}
 // Ensure every wallet coin is at vout>=1 so Create Vault cannot take the direct path.
 async function breakOutputZero(){
  const zeros=(await p.getUtxos(owner)).filter(u=>u.vout===0&&!u.token);if(!zeros.length)return;
  const builder=new TransactionBuilder({provider:p});let total=0n;
  for(const coin of zeros){builder.addInput(coin,key.unlockP2PKH());total+=coin.satoshis;}
  builder.addOutput({to:burner,amount:1000n}).addOutput({to:owner,amount:total-11000n});
  await rpc('sendrawtransaction',[builder.build()]);await p.refresh();
 }
 await fundWallet();await mine();await breakOutputZero();await mine();
 const clock=(await rpc('getblockchaininfo')).mediantime,params:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:clock-1000,periodSeconds:100,periods:4,cap:2000n};
 const utxos=await p.getUtxos(owner);assert.ok(utxos.some(u=>!u.token));
 assert.equal(utxos.filter(u=>u.vout===0&&!u.token).length,0,'fixture must lack wallet-owned vout=0');


 const combos:unknown[]=[];const attacks:string[]=[];let testedSafety=false;
 async function register(config:import('../src/v3/indexer.js').Config){
  const req=p.requests,b=p.broadcasts,h=await rpc('getblockcount'),t=performance.now();
  const op=await wallet.offer(config,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys);
  const auth=await wallet.authorize(op.id),milliseconds=performance.now()-t,electrumRequests=p.requests-req,discoveryBenchmark={...discovery};
  if(!testedSafety){
   const reject=async(label:string,mutate:(plan:BrowserPlan)=>void)=>{const changed=structuredClone(auth.plan);mutate(changed);const raw=sign(changed);const [result]=await rpc('testmempoolaccept',[[raw]]);assert.equal(result.allowed,false,label);attacks.push(label);};
   await reject('reserve diversion',plan=>{const tx=plan.request.transaction as Transaction;tx.outputs[2]!.valueSatoshis-=1n;tx.outputs[tx.outputs.length-1]!.valueSatoshis+=1n;});
   await reject('owner change diversion',plan=>{const tx=plan.request.transaction as Transaction;tx.outputs[tx.outputs.length-1]!.lockingBytecode=hexToBin('76a914'+'11'.repeat(20)+'88ac');});
   // A valid signature for wallet input 3 cannot authorize registry input 0.
   const signed=decodeTransaction(hexToBin(sign(auth.plan)));assert.notEqual(typeof signed,'string');if(typeof signed==='string')throw Error(signed);
   const pushes=(await import('@bitauth/libauth')).decodeAuthenticationInstructions(signed.inputs[3]!.unlockingBytecode),signature=pushes[0]!;assert.ok('data' in signature);
   signed.inputs[0]!.unlockingBytecode=hexToBin(binToHex(auth.plan.request.sourceOutputs[0]!.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex((signature as {data:Uint8Array}).data)));
   const [reused]=await rpc('testmempoolaccept',[[binToHex(encodeTransaction(signed))]]);assert.equal(reused.allowed,false);attacks.push('cross-input signature reuse');
   const duplicate=await wallet.offer(config,{stake:2000n,duration:3600,reward:1100n,maxWins:1},keys);
   await assert.rejects(()=>wallet.authorize(duplicate.id),/reserved/);await wallet.discard(duplicate.id);
   testedSafety=true;
  }
  assert.equal(op.registrationMode,'atomic');assert.equal(op.step,'action');assert.equal(op.funding,undefined);
  assert.equal(auth.plan.inputPaths[0]![0],0,'distinct registry signature is requested');
  const inputConfirmations=await Promise.all((auth.plan.request.transaction as Transaction).inputs.slice(3).map(async i=>(await rpc('getrawtransaction',[binToHex(i.outpointTransactionHash),true])).confirmations??0));
  if(combos.length===0)assert.ok(inputConfirmations.every(n=>n>0),'first case uses confirmed wallet inputs');
  const aBefore=approvals;const raw=sign(auth.plan),sent=await wallet.submit(op.id,raw);assert.equal(sent.stage,'pending',sent.error);
  assert.equal(approvals-aBefore,1);assert.equal(p.broadcasts-b,1);assert.equal(await rpc('getblockcount'),h);
  const tx=await rpc('getrawtransaction',[sent.txid,true]);assert.equal(tx.confirmations,undefined);
  const state=await new AssetIndexer(p,config).sync();assert.equal(state.instance.state[5],1);assert.equal(state.provisional,true);
  const entry=records(state.instance.state)[0]!;assert.equal(entry.owner,keys[0]!.publicKey);assert.equal(entry.stake,2000);assert.equal(entry.duration,3600);assert.equal(entry.reward,1000);assert.equal(entry.maxWins,1);assert.equal(rankings(state.instance.state,false)[0]!.slot,0);
  const reviewed=auth.plan.request.transaction as Transaction;
  assert.equal(reviewed.outputs[2]!.valueSatoshis,auth.plan.request.sourceOutputs[2]!.valueSatoshis);assert.equal(reviewed.outputs[2]!.token?.amount,auth.plan.request.sourceOutputs[2]!.token?.amount);assert.deepEqual(reviewed.outputs[2]!.token?.category,auth.plan.request.sourceOutputs[2]!.token?.category);assert.equal(reviewed.outputs[2]!.token?.nft,undefined);
  if(config.stakingAsset.kind==='bch')assert.equal(reviewed.outputs[1]!.valueSatoshis-auth.plan.request.sourceOutputs[1]!.valueSatoshis,2000n);
  else assert.equal(reviewed.outputs[1]!.token!.amount-(auth.plan.request.sourceOutputs[1]!.token?.amount??0n),2000n);
  assert.equal(discoveryBenchmark.addresses,6);
  const claim=await approve(await wallet.claim(config,keys));
  assert.equal((await new AssetIndexer(p,config).sync()).allocations.length,1);assert.equal(await rpc('getblockcount'),h);
  return {txid:sent.txid,claim:claim.txid,approvals:1,transactions:1,fee:op.plan!.fee,milliseconds,electrumRequests,inputConfirmations,discovery:discoveryBenchmark,bytes:raw.length/2};
 }
 const tokenAssets:Asset[]=[];
 for(let i=0;i<2;i++){
  const raw=await rpc('createrawtransaction',[[],{[owner]:0.015}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]);
  const signed=await rpc('signrawtransactionwithwallet',[funded.hex]),seed=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();
  const zero=utxo(await p.transactionStatus(seed),0);
  const mint=new TransactionBuilder({provider:p}).addInput(zero,key.unlockP2PKH()).addOutput({to:owner,amount:zero.satoshis-11000n,token:{category:seed,amount:100000n}}).addOutput({to:burner,amount:1000n});
  await rpc('sendrawtransaction',[mint.build()]);await p.refresh();tokenAssets.push({kind:'token',category:seed});
 }
 await mine();
 const bch:Asset={kind:'bch'};
 for(const [stakingAsset,rewardAsset]of [[bch,bch],[bch,tokenAssets[0]!],[tokenAssets[0]!,bch],[tokenAssets[0]!,tokenAssets[1]!],[tokenAssets[0]!,tokenAssets[0]!]] as [Asset,Asset][]){
  await fundWallet(0.08);await breakOutputZero();
  const vault=await approve(await wallet.create({...params,registryVersion:4,stakingAsset,rewardAsset},keys));
  if(combos.length===0)await mine();
  console.log('Testing atomic registration',stakingAsset.kind,rewardAsset.kind);
  combos.push({staking:stakingAsset,reward:rewardAsset,...await register(vault.config!)});await mine();
 }

 assert.ok((combos as {inputConfirmations:number[]}[]).some(c=>c.inputConfirmations.some(n=>n===0)),'at least one registration exercises unconfirmed wallet funding');
 console.log('Testing legacy compatibility and recovery');
 await fundWallet();
 const legacy=await approve(await wallet.create({...params},keys));
 const legacyStart=performance.now(),legacyRequests=p.requests;
 let oldOffer=await wallet.offer(legacy.config!,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys);
 assert.equal(oldOffer.registrationMode,undefined);const legacyA=approvals,legacyB=p.broadcasts;
 const legacyAuth=await wallet.authorize(oldOffer.id),legacyUntilFirstAuthorization=performance.now()-legacyStart;oldOffer=await wallet.submit(oldOffer.id,sign(legacyAuth.plan));assert.equal(oldOffer.stage,'pending');oldOffer=await approve(await wallet.resume(oldOffer.id));
 assert.ok(oldOffer.fundingRaw&&oldOffer.fundingPlan&&oldOffer.raw);const savedLegacy=structuredClone(journal.get(oldOffer.id));
 assert.equal(approvals-legacyA,2);assert.equal(p.broadcasts-legacyB,2);
 const before={approvals:2,transactions:2,fees:20000,preparationMilliseconds:legacyUntilFirstAuthorization,totalMilliseconds:performance.now()-legacyStart,electrumRequests:p.requests-legacyRequests};
 assert.equal((await new AssetIndexer(p,legacy.config!).sync()).instance.state[5],1);
 assert.deepEqual(journal.get(oldOffer.id),savedLegacy,'no migration mutates legacy signed records');await mine();

 console.log('Testing refusal, race, uncertain broadcast, eviction and reorganization');
 const safety=await approve(await wallet.create({...params,registryVersion:4},keys));await mine();
 const refused=await wallet.offer(safety.config!,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys),noBroadcast=p.broadcasts;
 await wallet.signingFailed(refused.id,'User rejected',true);assert.equal(p.broadcasts,noBroadcast);assert.equal(journal.get(refused.id)!.signing,'rejected');assert.equal(journal.get(refused.id)!.raw,undefined);await wallet.discard(refused.id);
 const first=await wallet.offer(safety.config!,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys),firstAuth=await wallet.authorize(first.id),firstRaw=sign(firstAuth.plan);
 // A different browser/wallet cannot share our local reservation table.
 const otherJournal=new Map<string,Operation>(),other=new AssetWallet(p,{list:async()=>structuredClone([...otherJournal.values()]),save:async op=>{otherJournal.set(op.id,structuredClone(op));}});
 const competing=await other.offer(safety.config!,{stake:3000n,duration:3600,reward:1000n,maxWins:1},keys),otherAuth=await other.authorize(competing.id),otherRaw=sign(otherAuth.plan);
 p.loseAcknowledgement=true;const uncertain=await other.submit(competing.id,otherRaw);assert.equal(uncertain.stage,'prepared');assert.equal(uncertain.raw,otherRaw);
 const broadcasts=p.broadcasts;assert.equal((await other.resume(competing.id)).stage,'pending');assert.equal(p.broadcasts,broadcasts);
 await assert.rejects(()=>wallet.submit(first.id,firstRaw),/state changed/i);assert.equal(journal.get(first.id)!.raw,firstRaw,'stale signed authorization remains durable');
 assert.equal((await wallet.resume(first.id)).stage,'conflicted');assert.equal(p.broadcasts,broadcasts);
 const [conflict]=await rpc('testmempoolaccept',[[firstRaw]]);assert.equal(conflict.allowed,false);
 await restartWithoutMempool();p.headerCache.clear();await p.refresh();
 assert.equal((await other.resume(competing.id)).stage,'prepared');const retried=await other.rebroadcast(competing.id);assert.equal(retried.stage,'pending');assert.equal(retried.raw,otherRaw);
 await mine();assert.equal((await other.resume(competing.id)).stage,'confirmed');
 const block=(await rpc('getrawtransaction',[retried.txid,true])).blockhash;
 await rpc('invalidateblock',[block]);p.headerCache.clear();await p.refresh();assert.equal((await other.resume(competing.id)).stage,'pending');
 await rpc('reconsiderblock',[block]);p.headerCache.clear();await p.refresh();assert.equal((await other.resume(competing.id)).stage,'confirmed');
 await writeFile('docs/blaze2026/atomic-offer-results.json',JSON.stringify({verifiedAt:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,realCashonizeApproval:false,before,attacks,recovery:{legacy:true,refusal:true,staleSignedRetention:true,competingSpends:true,lostAcknowledgement:true,evictionIdenticalRetry:true,reorganization:true},combinations:combos},null,2)+'\n');
}));
