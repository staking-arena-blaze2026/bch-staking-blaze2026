import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {rpc} from '../src/rpc.js';
import {utxo,records,rankings} from '../src/arena-core.js';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress,type Parameters,type Asset} from '../src/v3/protocol.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';
import {writeFile} from 'node:fs/promises';

test('direct genesis and caller-funded claims: four asset pairs, independent caller, change, signed-plan safety and durable recovery on BCHN',{timeout:600000},()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {
  loseAcknowledgement=false;broadcasts=0;
  override async sendRawTransaction(raw:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,true,JSON.stringify(a));this.broadcasts++;const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Lost acknowledgement after acceptance');}return id;}
  override async tip(){return this.header(await rpc('getblockcount'));}
 }
 const provider=new Local(await rpc('getblockcount')),miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);provider.headerCache.clear();await provider.refresh();}
 const staker=new SignatureTemplate(new Uint8Array(32).fill(91)),caller=new SignatureTemplate(new Uint8Array(32).fill(92)),poor=new SignatureTemplate(new Uint8Array(32).fill(93));
 const keys=(key:SignatureTemplate):WalletKey[]=>[{publicKey:binToHex(key.publicKey),path:'receive',index:0}];
 const address=(key:SignatureTemplate)=>ownerAddress(key.publicKey,provider);
 const journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}},wallet=new AssetWallet(provider,store);
 await rpc('sendtoaddress',[address(staker),0.1]);await rpc('sendtoaddress',[address(caller),0.001]);await mine();
 function sign(plan:BrowserPlan,key:SignatureTemplate,mutate?:(tx:Transaction)=>void){const tx=structuredClone(plan.request.transaction) as Transaction;mutate?.(tx);
  for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i],preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i].unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function finish(op:Operation){await wallet.authorize(op.id);op=await wallet.submit(op.id,sign(op.plan!,staker));assert.equal(op.stage,'pending');await mine();op=await wallet.resume(op.id);op=await wallet.submit(op.id,sign(op.plan!,staker));assert.equal(op.stage,'pending');await mine();return wallet.resume(op.id);}
 // Mint a genuine fungible asset to the staker, with an unrelated NFT at the caller.
 const funding=await rpc<string>('sendtoaddress',[address(staker),0.02]),fundTx=await rpc('getrawtransaction',[funding,true]);
 // The category genesis must spend output zero of its preparation transaction.
 const source=utxo(fundTx,fundTx.vout.findIndex((o:any)=>Math.round(o.value*1e8)===2000000));
 const pre=await new TransactionBuilder({provider}).addInput(source,staker.unlockP2PKH()).addOutput({to:address(staker),amount:1990000n}).build();
 const preId=await rpc<string>('sendrawtransaction',[pre]),mint=new TransactionBuilder({provider}).addInput(utxo(await rpc('getrawtransaction',[preId,true]),0),staker.unlockP2PKH()).addOutput({to:address(staker),amount:1978000n,token:{category:preId,amount:100000n}}).addOutput({to:address(caller),amount:1000n,token:{category:preId,amount:0n,nft:{capability:'none',commitment:'12'}}}).addOutput({to:address(staker),amount:1000n,token:{category:preId,amount:0n,nft:{capability:'none',commitment:'34'}}});
 const mintId=await rpc<string>('sendrawtransaction',[mint.build()]);await mine();
 const token:Asset={kind:'token',category:preId},bch:Asset={kind:'bch'},evidence=[];
 for(const [stakingAsset,rewardAsset] of [[bch,bch],[bch,token],[token,bch],[token,token]] as [Asset,Asset][]){
  const mtp=(await rpc('getblockchaininfo')).mediantime,p:Parameters={version:3,stakingAsset,rewardAsset,epoch:mtp-1000,periodSeconds:100,periods:4,cap:2000n};
  // Fixture only: place existing confirmed BCH at output zero. Direct creation
  // itself must broadcast exactly once and never prepare wallet coins.
  const funding=await rpc<string>('sendtoaddress',[address(staker),0.02]),parent=await rpc('getrawtransaction',[funding,true]);
  const source=utxo(parent,parent.vout.findIndex((o:any)=>Math.round(o.value*1e8)===2000000));
  const seedRaw=new TransactionBuilder({provider}).addInput(source,staker.unlockP2PKH()).addOutput({to:address(staker),amount:1990000n}).build();await rpc('sendrawtransaction',[seedRaw]);await mine();
  const nftBefore=await rpc('gettxout',[mintId,1,true]);
  let creation=await wallet.create(p,keys(staker));assert.equal(creation.step,'action');assert.equal(creation.creationMode,'direct');
  const createBefore=provider.broadcasts,originalCreation=structuredClone(journal.get(creation.id)!);
  await wallet.signingFailed(creation.id,'User rejected genesis');assert.equal(provider.broadcasts,createBefore);assert.equal(journal.get(creation.id)!.raw,undefined);
  // Saved plans are reconstructed, including signing metadata, before authorization.
  journal.get(creation.id)!.plan!.request.transaction.outputs[2]!.valueSatoshis--;
  await assert.rejects(()=>wallet.authorize(creation.id),/Saved genesis/);journal.set(creation.id,structuredClone(originalCreation));
  journal.get(creation.id)!.plan!.request.sourceOutputs[0]!.contract={redeemScript:hexToBin('51')} as any;
  const authorizedCreation=await wallet.authorize(creation.id);assert.equal(authorizedCreation.plan.request.sourceOutputs[0]!.contract,undefined);journal.set(creation.id,structuredClone(originalCreation));assert.equal(authorizedCreation.plan.request.broadcast,false);
  assert.equal(authorizedCreation.plan.inputPaths.length,creation.plan!.request.transaction.inputs.length);
  for(const mutate of [(t:Transaction)=>{t.outputs[0]!.token!.nft!.commitment=new Uint8Array(32);},(t:Transaction)=>{t.outputs[2]!.valueSatoshis--;},(t:Transaction)=>{t.outputs[1]!.lockingBytecode=hexToBin('51');}])await assert.rejects(()=>wallet.submit(creation.id,sign(creation.plan!,staker,mutate)),/changed/);
  assert.equal(provider.broadcasts,createBefore);
  const brokenCreation=new AssetWallet(provider,{list:store.list,save:async()=>{throw Error('Genesis disk quota');}});await assert.rejects(()=>brokenCreation.submit(creation.id,sign(authorizedCreation.plan,staker)),/quota/);assert.equal(provider.broadcasts,createBefore);
  provider.loseAcknowledgement=true;creation=await wallet.submit(creation.id,sign(authorizedCreation.plan,staker));assert.equal(creation.stage,'prepared',creation.error);assert.ok(creation.raw);assert.equal(provider.broadcasts,createBefore+1);
  const genesisId=creation.txid!,genesisTx=await rpc('getrawtransaction',[genesisId,true]);assert.equal(genesisTx.confirmations,undefined);assert.notEqual(genesisId,genesisTx.vin[0].txid);assert.equal(genesisTx.vin[0].vout,0);
  assert.equal(genesisTx.vout[0].tokenData.category,genesisTx.vin[0].txid);assert.equal(genesisTx.vout[0].tokenData.nft.capability,'mutable');
  assert.equal(genesisTx.vout[2].tokenData?.amount??BigInt(Math.round(genesisTx.vout[2].value*1e8))-1000n,rewardAsset.kind==='token'?'8000':8000n);
  // Reopening the engine retains exact bytes and pending public configuration.
  const reloaded=new AssetWallet(provider,store),pending=await reloaded.resume(creation.id);assert.equal(pending.stage,'pending');assert.equal(pending.config!.genesis,genesisId);assert.equal(pending.raw,creation.raw);
  provider.hidden.add(genesisId);const missing=await reloaded.resume(creation.id);assert.equal(missing.stage,'prepared');assert.equal(missing.raw,creation.raw);assert.equal(provider.broadcasts,createBefore+1);provider.hidden.delete(genesisId);assert.equal((await reloaded.resume(creation.id)).stage,'pending');
  assert.ok(await rpc('gettxout',[mintId,2,true]),'Unrelated wallet NFT must remain unspent');
  assert.equal((await new AssetIndexer(provider,pending.config!).sync()).provisional,true);
  await mine();const created=await reloaded.resume(creation.id),config=created.config!;assert.equal(created.stage,'confirmed');
  const confirmedGenesis=await rpc('getrawtransaction',[genesisId,true]);await rpc('invalidateblock',[confirmedGenesis.blockhash]);provider.headerCache.clear();await provider.refresh();assert.equal((await reloaded.resume(creation.id)).stage,'pending');
  await rpc('reconsiderblock',[confirmedGenesis.blockhash]);provider.headerCache.clear();await provider.refresh();assert.equal((await reloaded.resume(creation.id)).stage,'confirmed');
  const nftAfter=await rpc('gettxout',[mintId,1,true]);assert.deepEqual(nftAfter.tokenData,nftBefore.tokenData);assert.equal(nftAfter.value,nftBefore.value);assert.deepEqual(nftAfter.scriptPubKey,nftBefore.scriptPubKey);
  await assert.rejects(()=>wallet.create(p,keys(poor)),/output 0/);
  assert.equal((await new AssetIndexer(provider,config).sync()).instance.category,genesisTx.vin[0].txid);
  const offer=await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys(staker));
  assert.equal(offer.terms!.maxWins,1);assert.equal(offer.plan!.request.transaction.outputs[0]!.token?.amount??offer.plan!.request.transaction.outputs[0]!.valueSatoshis,3000n);
  await finish(offer);
  await assert.rejects(()=>wallet.claim(config,keys(poor)),/Insufficient BCH/);
  let op=await wallet.claim(config,keys(caller));assert.equal(op.kind,'claim');assert.equal(op.step,'action');assert.notEqual(op.owner.publicKey,keys(staker)[0]!.publicKey);assert.deepEqual(op.plan!.inputPaths,[[3,'receive',0]]);
  assert.equal(op.plan!.request.sourceOutputs[3]!.token,undefined);const tx=op.plan!.request.transaction as Transaction,required=10000n+(stakingAsset.kind==='token'?1000n:0n)+(rewardAsset.kind==='token'?1000n:0n);
  assert.equal(tx.inputs.length,4);assert.equal(tx.outputs.length,6);assert.equal(tx.outputs[5]!.valueSatoshis,op.plan!.request.sourceOutputs[3]!.valueSatoshis-required);assert.deepEqual(tx.outputs[5]!.lockingBytecode,op.plan!.request.sourceOutputs[3]!.lockingBytecode);assert.equal(tx.outputs[3]!.token?.amount??tx.outputs[3]!.valueSatoshis,2000n);
  const before=provider.broadcasts;await wallet.signingFailed(op.id,'User rejected signing');assert.match(journal.get(op.id)!.error!,/rejected/);assert.equal(provider.broadcasts,before);
  await wallet.authorize(op.id);
  for(const mutate of [(t:Transaction)=>{t.outputs[3]!.lockingBytecode=t.outputs[5]!.lockingBytecode;},(t:Transaction)=>{t.outputs[5]!.valueSatoshis--;},(t:Transaction)=>{t.outputs[5]!.lockingBytecode=t.outputs[3]!.lockingBytecode;}]){const bad=sign(op.plan!,caller,mutate);await assert.rejects(()=>wallet.submit(op.id,bad),/changed/);const [accept]=await rpc('testmempoolaccept',[[bad]]);assert.equal(accept.allowed,false,'Covenant must reject even a newly signed diversion');}
  // Persisted plan corruption must fail even before any signing request.
  const original=structuredClone(journal.get(op.id)!);journal.get(op.id)!.plan!.request.transaction.outputs[3]!.lockingBytecode=hexToBin('51');await assert.rejects(()=>wallet.authorize(op.id),/Saved claim/);journal.set(op.id,structuredClone(original));
  // WalletConnect controls are outside the transaction identity: never let saved
  // metadata enable wallet broadcasting or supply a substituted signing script.
  journal.get(op.id)!.plan!.request.broadcast=true;await assert.rejects(()=>wallet.authorize(op.id),/disable wallet broadcasting/);journal.set(op.id,structuredClone(original));
  journal.get(op.id)!.plan!.request.sourceOutputs[3]!.contract=structuredClone(op.plan!.request.sourceOutputs[0]!.contract);
  const authorized=await wallet.authorize(op.id);assert.equal(authorized.plan.request.broadcast,false);assert.equal(authorized.plan.request.sourceOutputs[3]!.contract,undefined);assert.deepEqual(authorized.plan.inputPaths,[[3,'receive',0]]);journal.set(op.id,structuredClone(original));
  assert.equal(provider.broadcasts,before);
  const broken=new AssetWallet(provider,{list:store.list,save:async()=>{throw Error('Disk quota');}});await assert.rejects(()=>broken.submit(op.id,sign(op.plan!,caller)),/quota/);assert.equal(provider.broadcasts,before);
  provider.loseAcknowledgement=true;op=await wallet.submit(op.id,sign(op.plan!,caller));assert.equal(op.stage,'prepared');assert.ok(op.raw);assert.equal(provider.broadcasts,before+1);
  const restarted=new AssetWallet(provider,store);assert.equal((await restarted.resume(op.id)).stage,'pending');assert.equal(provider.broadcasts,before+1);await mine();op=await restarted.resume(op.id);assert.equal(op.stage,'confirmed');
  const snapshot=await new AssetIndexer(provider,config).sync();assert.equal(snapshot.allocations.length,1);assert.equal(snapshot.allocations[0]!.mature,false);assert.equal(snapshot.instance.state[52],1);assert.equal(records(snapshot.instance.state,false)[0]!.maxWins,1);assert.equal(rankings(snapshot.instance.state,false).length,0);
  assert.equal(snapshot.allocations[0]!.terms.readUInt32LE(70),3000);
  const change=await rpc('gettxout',[op.txid,5]);assert.equal(BigInt(Math.round(change.value*1e8)),tx.outputs[5]!.valueSatoshis);
  if(stakingAsset.kind==='bch'&&rewardAsset.kind==='bch'){
   await finish(await wallet.offer(config,{stake:3000n,duration:513,reward:2000n,maxWins:1},keys(staker)));
   // Smallest exact-sized fee coin produces no change, without a preparation transaction.
   await rpc('sendtoaddress',[address(caller),0.0001]);await mine();
   const exact=await wallet.claim(config,keys(caller));assert.equal(exact.plan!.request.transaction.outputs.length,5);assert.equal(exact.plan!.request.sourceOutputs[3]!.valueSatoshis,10000n);
   const paid=await wallet.submit(exact.id,sign(exact.plan!,caller));assert.equal(paid.stage,'pending');await mine();assert.equal((await wallet.resume(paid.id)).stage,'confirmed');
  }
  evidence.push({staking:stakingAsset.kind,reward:rewardAsset.kind,txid:op.txid,inputs:4,outputs:6,minerFee:'10000',carriers:String(required-10000n),change:String(tx.outputs[5]!.valueSatoshis)});
 }
 assert.ok(await rpc('gettxout',[mintId,1]),'Caller NFT must remain unspent');
 await writeFile('docs/blaze2026/caller-fee-regression.json',JSON.stringify({network:'isolated BCHN regtest',verifiedAt:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,evidence,physicalCashonizeVerified:false},null,2)+'\n');
}));
