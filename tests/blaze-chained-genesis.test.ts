import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,decodeTransaction,createVirtualMachineBch2026,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {utxo} from '../src/arena-core.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,chainedChildBuilder,chainedPreparation,chainedGenesisRefundBuilder,chainedFundingRecoverBuilder,type Parameters,type Asset,FEE,CARRIER} from '../src/v3/protocol.js';
import type {WalletKey,BrowserPlan} from '../src/transactions-core.js';

test('isolated BCHN 29.2: one-approval chained genesis without wallet vout=0',{timeout:900000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {
  requests=0;broadcasts=0;
  override async sendRawTransaction(raw:string){const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;}
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

 // 1–3: no vout=0 → chained, one approval, two txs, no mining between parent and child.
 const heightBefore=await rpc('getblockcount'),a0=approvals,b0=p.broadcasts,t0=performance.now(),req0=p.requests;
 const prepared=await wallet.create(params,keys);
 assert.equal(prepared.creationMode,'chained');
 const untilSigning={requests:p.requests-req0,milliseconds:performance.now()-t0,addresses:discovery.addresses};
 const created=await approve(prepared);
 assert.equal(approvals-a0,1);assert.equal(p.broadcasts-b0,2);
 assert.ok(created.funding&&created.fundingRaw&&created.childRaw&&created.txid);
 assert.notEqual(created.funding,created.txid);
 assert.equal(created.config?.genesis,created.txid);
 const parentTx=await rpc('getrawtransaction',[created.funding,true]);
 const childTx=await rpc('getrawtransaction',[created.txid,true]);
 assert.equal(parentTx.confirmations,undefined);assert.equal(childTx.confirmations,undefined);
 assert.equal(childTx.vin[0].txid,created.funding);assert.equal(childTx.vin[0].vout,0);assert.equal(childTx.vin[1].vout,1);
 assert.equal(childTx.vout[0].tokenData.category,created.funding);
 assert.equal(await rpc('getblockcount'),heightBefore);
 const snap=await new AssetIndexer(p,created.config!).sync();assert.equal(snap.provisional,true);assert.equal(snap.instance.category,created.funding);

 // 12: wallet rejection before parent signed leaves no broadcast.
 const refused=await wallet.create({...params,cap:2100n},keys);const broadcasts=p.broadcasts;
 await wallet.signingFailed(refused.id,'User rejected');assert.equal(p.broadcasts,broadcasts);assert.equal(journal.get(refused.id)!.raw,undefined);

 // 4–6 + 13: four asset combinations, fees/reserve, then offer+claim at 0-conf.
 const tokenAssets:Asset[]=[];
 for(let i=0;i<2;i++){
  const raw=await rpc('createrawtransaction',[[],{[owner]:0.015}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]);
  const signed=await rpc('signrawtransactionwithwallet',[funded.hex]),seed=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();
  const zero=utxo(await p.transactionStatus(seed),0);
  const mint=new TransactionBuilder({provider:p}).addInput(zero,key.unlockP2PKH()).addOutput({to:owner,amount:zero.satoshis-11000n,token:{category:seed,amount:100000n}}).addOutput({to:burner,amount:1000n});
  await rpc('sendrawtransaction',[mint.build()]);await p.refresh();tokenAssets.push({kind:'token',category:seed});
 }
 await mine();await breakOutputZero();
 const bch:Asset={kind:'bch'},combinations=[],theftBlocked:string[]=[];
 for(const [stakingAsset,rewardAsset]of [[bch,bch],[bch,tokenAssets[0]!],[tokenAssets[0]!,bch],[tokenAssets[0]!,tokenAssets[1]!]] as [Asset,Asset][]){
  await fundWallet(0.08);await breakOutputZero();const height=await rpc('getblockcount'),a=approvals,b=p.broadcasts;
  const vault=await approve(await wallet.create({...params,stakingAsset,rewardAsset,cap:2000n},keys));
  assert.equal(vault.creationMode,'chained');assert.equal(approvals-a,1);assert.equal(p.broadcasts-b,2);
  const parent=await rpc('getrawtransaction',[vault.funding!,true]),child=await rpc('getrawtransaction',[vault.txid!,true]);
  assert.equal(parent.confirmations,undefined);assert.equal(child.confirmations,undefined);
  const reserve=8000n; // cap 2000 * periods 4
  if(rewardAsset.kind==='bch')assert.equal(BigInt(Math.round(child.vout[2].value*1e8)),1000n+reserve);
  else assert.equal(BigInt(child.vout[2].tokenData.amount),reserve);
  let offer=await approve(await wallet.offer(vault.config!,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys));
  offer=await approve(await wallet.resume(offer.id));
  const claim=await approve(await wallet.claim(vault.config!,keys));
  const state=await new AssetIndexer(p,vault.config!).sync();
  assert.equal(state.allocations.length,1);assert.equal(state.provisional,true);assert.equal(await rpc('getblockcount'),height);
  combinations.push({staking:stakingAsset.kind,reward:rewardAsset.kind,genesis:vault.txid,claim:claim.txid,authorizations:approvals-a,transactions:p.broadcasts-b});
  await mine();
 }

 // 7–9: theft / alternate genesis / front-run attempts against a fresh preparation.
 await fundWallet(0.05);await breakOutputZero();
 const secured=await approve(await wallet.create({...params,cap:2200n},keys));
 // Parent already spent into child in approve(); reconstruct a parallel parent to attack mid-flight instead.
 await fundWallet(0.05);await breakOutputZero();
 const attackPrep=await wallet.create({...params,cap:2300n},keys);
 const attackAuth=await wallet.authorize(attackPrep.id),attackParentRaw=sign(attackAuth.plan!);
 const attackChild=wallet.buildChainedChild(attackPrep,attackParentRaw);
 await p.sendRawTransaction(attackParentRaw);
 const parentId=attackChild.parentId,prep=chainedPreparation(attackPrep.parameters,key.publicKey,p);
 const factory=utxo(await p.transactionStatus(parentId),0),funding=utxo(await p.transactionStatus(parentId),1);
 // Divert reserve to attacker P2PKH — must fail VM / mempool.
 const steal=new TransactionBuilder({provider:p}).addInput(factory,prep.genesis.unlock.create()).addInput(funding,prep.funding.unlock.fundGenesis())
  .addOutput({to:owner,amount:1000n}).addOutput({to:owner,amount:1000n}).addOutput({to:owner,amount:funding.satoshis-1000n});
 const stealRaw=steal.build();
 const stealVm=createVirtualMachineBch2026().verify({transaction:decodeTransaction(hexToBin(stealRaw)) as Transaction,sourceOutputs:[{valueSatoshis:factory.satoshis,lockingBytecode:hexToBin(factory.lockingBytecode!)},{valueSatoshis:funding.satoshis,lockingBytecode:hexToBin(funding.lockingBytecode!)}]});
 assert.notEqual(stealVm,true);theftBlocked.push('divert-reserve');
 const [stealAccept]=await rpc('testmempoolaccept',[[stealRaw]]);assert.equal(stealAccept.allowed,false);theftBlocked.push('mempool-reject-divert');
 // Substitute unrelated reward input from a different parent — V4 same-parent check must fail.
 const decoy=await rpc<string>('sendtoaddress',[owner,0.0001]);await p.refresh();
 const decoyUtxo=utxo(await p.transactionStatus(decoy),0);
 try{
  const bad=chainedChildBuilder(attackPrep.parameters,factory,{...funding,txid:decoy,vout:0,satoshis:decoyUtxo.satoshis,lockingBytecode:decoyUtxo.lockingBytecode},key.publicKey,p);
  bad.builder.build();assert.fail('expected parent-linkage rejection');
 }catch(e){assert.match(String(e),/companion|Incorrect chained|funding/i);theftBlocked.push('parent-substitution');}
 // Valid child still works (front-run of the intended layout is not theft).
 const front=await p.sendRawTransaction(attackChild.raw);assert.equal(front,attackChild.txid);theftBlocked.push('intended-child-ok');
 const frontTx=await rpc('getrawtransaction',[attackChild.txid,true]);
 assert.equal(frontTx.vin[0].txid,parentId);assert.equal(frontTx.vout[0].tokenData.category,parentId);
 assert.ok((await rpc<string[]>('getrawmempool')).includes(attackChild.txid));
 // Mine so Electrum history indexes the registry output before full indexer replay.
 await mine();assert.equal((await new AssetIndexer(p,{...attackPrep.parameters,genesis:attackChild.txid}).sync()).provisional,false);

 // 11: owner recovery of an abandoned preparation (parent broadcast, child withheld).
 await fundWallet(0.05);await breakOutputZero();
 const abandoned=await wallet.create({...params,cap:2400n},keys);
 const abandonedAuth=await wallet.authorize(abandoned.id),abandonedParent=sign(abandonedAuth.plan!);
 const abandonedChild=wallet.buildChainedChild(abandoned,abandonedParent);
 await p.sendRawTransaction(abandonedParent);
 const abandonedFactory=utxo(await p.transactionStatus(abandonedChild.parentId),0),abandonedFunding=utxo(await p.transactionStatus(abandonedChild.parentId),1);
 const feeCoin=(await p.getUtxos(owner)).filter(u=>!u.token&&u.satoshis>=FEE+CARRIER).sort((a,b)=>a.satoshis<b.satoshis?-1:1)[0]!;
 const feeExact=new TransactionBuilder({provider:p}).addInput(feeCoin,key.unlockP2PKH()).addOutput({to:owner,amount:FEE}).addOutput({to:owner,amount:feeCoin.satoshis-FEE-10000n});
 const feeSplit=await rpc<string>('sendrawtransaction',[feeExact.build()]);await p.refresh();
 const feeUtxo=utxo(await p.transactionStatus(feeSplit),0),fee2=utxo(await p.transactionStatus(feeSplit),1);
 // Split a second exact fee for genesis refund.
 const fee2tx=new TransactionBuilder({provider:p}).addInput(fee2,key.unlockP2PKH()).addOutput({to:owner,amount:FEE}).addOutput({to:owner,amount:fee2.satoshis-FEE-10000n});
 const fee2id=await rpc<string>('sendrawtransaction',[fee2tx.build()]);await p.refresh();
 const genesisFee=utxo(await p.transactionStatus(fee2id),0),fundingFee=feeUtxo;
 const refundRaw=chainedGenesisRefundBuilder(abandonedFactory,{input:genesisFee,unlocker:key.unlockP2PKH()},key.publicKey,key,abandoned.parameters,p).build();
 const recoverRaw=chainedFundingRecoverBuilder(abandonedFunding,{input:fundingFee,unlocker:key.unlockP2PKH()},key.publicKey,key,abandoned.parameters,p).build();
 assert.equal((await rpc('testmempoolaccept',[[refundRaw]]))[0].allowed,true);
 assert.equal((await rpc('testmempoolaccept',[[recoverRaw]]))[0].allowed,true);
 await rpc('sendrawtransaction',[refundRaw]);await rpc('sendrawtransaction',[recoverRaw]);await p.refresh();
 // Child must now be impossible.
 const [childReject]=await rpc('testmempoolaccept',[[abandonedChild.raw]]);assert.equal(childReject.allowed,false);

 await writeFile('docs/blaze2026/chained-genesis-results.json',JSON.stringify({
  node:(await rpc('getnetworkinfo')).subversion,verifiedAt:new Date().toISOString(),
  noWalletVout0:true,creationMode:'chained',authorizations:1,transactions:2,parentChildWithoutMining:true,
  untilSigning,discovery,combinations,theftBlocked,recoveryWithoutLoss:true,walletRejection:true,
  zeroConfOfferClaim:true,packageAuthorizationSupported:false,realCashonizePromptsTested:false,
  genesis:created.txid,category:created.funding,securedGenesis:secured.txid,
 },null,2)+'\n');
}));
