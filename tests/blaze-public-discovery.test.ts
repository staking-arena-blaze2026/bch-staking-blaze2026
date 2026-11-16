import {emptyIndex,updatePublicIndex} from '../src/v3/public-index.js';
import {writeFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation,type Store} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {discoverPublicVaults} from '../src/v3/public-discovery.js';
import {ownerAddress} from '../src/v3/protocol.js';
import {records} from '../src/arena-core.js';
import type {BrowserPlan} from '../src/transactions-core.js';
function sign(plan:BrowserPlan,key:SignatureTemplate){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),sig=key.generateSignature(hash256(preimage));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=source.contract?new Uint8Array(Buffer.from(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig)),'hex')):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}return binToHex(encodeTransaction(tx));}
test('isolated BCHN: independent Alice/Bob discover V3 and V4 and Bob registers offers',{timeout:900000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {override async sendRawTransaction(raw:string){const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;}}
 const p=new Local(await rpc('getblockcount')),publicIndex=emptyIndex('regtest');
 function person(byte:number){const key=new SignatureTemplate(new Uint8Array(32).fill(byte)),keyInfo={publicKey:binToHex(key.publicKey),path:'receive' as const,index:0},journal=new Map<string,Operation>(),store:Store={list:async()=>structuredClone([...journal.values()]),save:async o=>{journal.set(o.id,structuredClone(o));}},wallet=new AssetWallet(p,store);return {key,keyInfo,journal,wallet,address:ownerAddress(key.publicKey,p)};}
 const alice=person(221),bob=person(222),miner=await rpc<string>('getnewaddress');
 async function mine(){await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();}
 for(const user of [alice,bob])await rpc('sendtoaddress',[user.address,0.1]);await mine();
 async function approve(user:ReturnType<typeof person>,op:Operation){const auth=await user.wallet.authorize(op.id),sent=await user.wallet.submit(op.id,sign(auth.plan!,user.key));assert.equal(sent.stage,'pending',sent.error);return sent;}
 const clock=(await rpc('getblockchaininfo')).mediantime;
 for(const registryVersion of [undefined,4] as const){
  const created=await approve(alice,await alice.wallet.create({version:3,...(registryVersion?{registryVersion}:{}),stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:clock-1000,periodSeconds:100,periods:4,cap:2000n},[alice.keyInfo]));
  const fresh=await discoverPublicVaults(p);const config=fresh.vaults.find(c=>c.genesis===created.txid);assert.ok(config,'fresh client discovers without Alice journal/config');assert.equal(config.registryVersion,registryVersion);assert.equal(bob.journal.size,registryVersion===undefined?0:1);
  assert.equal((await new AssetIndexer(p,config).sync()).provisional,true);
  await updatePublicIndex(publicIndex,[p]);assert.equal(publicIndex.candidates[created.txid!]?.status,'provisional','automatic static-index updater finds new 0-conf vault');
  await assert.rejects(()=>new AssetIndexer(p,{...config,cap:config.cap+1000n}).sync());
  let offered=await approve(bob,await bob.wallet.offer(config,{stake:3000n,duration:513,reward:1000n,maxWins:1},[bob.keyInfo]));
  if(registryVersion===undefined)offered=await approve(bob,await bob.wallet.resume(offered.id));
  const snapshot=await new AssetIndexer(p,config).sync();assert.equal(records(snapshot.instance.state,false)[0]?.owner,bob.keyInfo.publicKey);
  await mine();assert.equal((await new AssetIndexer(p,config).sync()).provisional,false);
  await updatePublicIndex(publicIndex,[p]);assert.equal(publicIndex.candidates[created.txid!]?.status,'observed-confirmed');
  const again=await discoverPublicVaults(p);assert.equal(again.vaults.filter(c=>c.genesis===created.txid).length,1);
 }
 await writeFile('docs/blaze2026/public-discovery-regtest-results.json',JSON.stringify({at:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,transport:'local Electrum protocol facade over isolated BCHN; not public chipnet',distinctAliceBobKeys:true,creatorJournalsNotUsedForDiscovery:true,v3AndAtomicV4:true,zeroConfAndConfirmation:true,bobRegistersBoth:true,maliciousParametersRejected:true,deduplicated:true,physicalCashonize:false},null,2)+'\n');
}));
