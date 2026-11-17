import test from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {announcementIn,resolveAnnouncement} from '../src/queue/discovery.js';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {ownerAddress} from '../src/v3/protocol.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {QueueIndexer} from '../src/queue/chain.js';
import * as q from '../src/queue/protocol.js';
import {ZERO} from '../src/queue/protocol.js';
test('queue wallet: public-key plans, explicit signing, durable recovery and owner stake withdrawal',{timeout:600000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {
  lose=false;
  override async sendRawTransaction(raw:string){const [valid]=await rpc('testmempoolaccept',[[raw]]);assert.equal(valid.allowed,true,JSON.stringify(valid));const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();if(this.lose){this.lose=false;throw Error('Lost broadcast acknowledgement');}return id;}
 }
 const p=new Local(await rpc('getblockcount')),request=p.request;
 p.request=async(method,...args)=>method==='blockchain.relayfee'?0.00001:request(method,...args);
 const key=new SignatureTemplate(new Uint8Array(32).fill(73)),address=ownerAddress(key.publicKey,p),miner=await rpc<string>('getnewaddress'),keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}],saved=new Map<string,Operation>();
 const wallet=new QueueWallet(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}});
 const raw=await rpc('createrawtransaction',[[],{[address]:0.2}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]);await rpc('sendrawtransaction',[signed.hex]);await p.refresh();
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const s=plan.request.sourceOutputs[i]!,sig=key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:s.contract?.redeemScript??s.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=s.contract?hexToBin(binToHex(s.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}return binToHex(encodeTransaction(tx));}
 const costs:{kind:string;step:string;bytes:number;fee:string}[]=[];let approvals=0;
 async function approve(op:Operation){const auth=await wallet.authorize(op.id);approvals++;await wallet.beginSigning(op.id);const raw=sign(auth.plan);await wallet.retain(op.id,raw);costs.push({kind:op.intent.kind,step:op.step,bytes:raw.length/2,fee:auth.plan.fee!});return wallet.broadcast(op.id);}
 const params={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
 let creation=await wallet.prepare({kind:'create',parameters:params},keys);assert.equal(creation.step,'queue-funding');creation=await approve(creation);creation=await wallet.resume(creation.id,keys);assert.equal(creation.step,'seed-funding');creation=await approve(creation);creation=await wallet.resume(creation.id,keys);assert.equal(creation.step,'action');creation=await approve(creation);assert.equal(approvals,3);
 const config=creation.config!,index=new QueueIndexer(p,config);const seed=await p.transactionStatus(creation.seed!.txid),announcement=announcementIn(seed);assert.ok(announcement);assert.deepEqual(await resolveAnnouncement(p,seed.txid,announcement),config);assert.equal((await index.sync()).ordered.length,0);
 // A confirmed competing root spend invalidates the saved bytes without rewriting them.
 const stale=await wallet.prepare({kind:'insert',config,terms:{stake:7000n,duration:512,reward:2000n}},keys),staleAuth=await wallet.authorize(stale.id);
 await wallet.beginSigning(stale.id);const staleRaw=sign(staleAuth.plan);await wallet.retain(stale.id,staleRaw);
 const fundingRaw=await rpc('createrawtransaction',[[],{[address]:0.03}]),fundingTx=await rpc('fundrawtransaction',[fundingRaw,{changePosition:1}]),fundingSigned=await rpc('signrawtransactionwithwallet',[fundingTx.hex]),fundingId=await rpc<string>('sendrawtransaction',[fundingSigned.hex]);await p.refresh();
 const snap=await index.sync(),competitor=q.insert(index.context(),snap.vault,snap.root,{stake:6000n,duration:512,reward:2000n},key,[{input:(await import('../src/arena-core.js')).utxo(await p.transactionStatus(fundingId),0),unlocker:key.unlockP2PKH()}]);
 await rpc('sendrawtransaction',[competitor.raw]);await rpc('generatetoaddress',[1,miner]);await p.refresh();
 const conflicted=await wallet.resume(stale.id,keys);assert.equal(conflicted.stage,'conflict');assert.equal(conflicted.raw,staleRaw);
 // Remove the competing offer to restore the fixture's empty queue.
 await approve(await wallet.prepare({kind:'cancel',config,offerId:competitor.offer.id},keys));
 const first=await wallet.prepare({kind:'insert',config,terms:{stake:10000n,duration:512,reward:2000n}},keys),authorized=await wallet.authorize(first.id),before=approvals;
 const tampered=structuredClone(authorized.plan);(tampered.request.transaction as Transaction).outputs.at(-1)!.valueSatoshis++;await assert.rejects(()=>wallet.retain(first.id,sign(tampered)),/Wallet changed/);
 await wallet.beginSigning(first.id);
 await wallet.signingFailed(first.id,false);
 await assert.rejects(()=>wallet.authorize(first.id),/Uncertain/);
 await assert.rejects(()=>wallet.discard(first.id),/uncertain/);
 await assert.rejects(()=>wallet.resume(first.id,keys),/Signing status unknown/);
 approvals++;const firstRaw=sign(authorized.plan);await wallet.retain(first.id,firstRaw);costs.push({kind:'insert',step:'action',bytes:firstRaw.length/2,fee:authorized.plan.fee!});p.lose=true;await assert.rejects(()=>wallet.broadcast(first.id),/Lost broadcast/);assert.equal((await wallet.get(first.id)).raw,firstRaw);assert.equal((await wallet.resume(first.id,keys)).stage,'pending');assert.equal(approvals-before,1);assert.equal((await index.sync()).ordered.length,1);
 const second=await approve(await wallet.prepare({kind:'insert',config,terms:{stake:8000n,duration:512,reward:2000n}},keys));
 const cancel=await approve(await wallet.prepare({kind:'cancel',config,offerId:second.offerId!},keys));assert.equal(cancel.sources.length,3);
 await approve(await wallet.prepare({kind:'claim',config},keys));
 await assert.rejects(()=>wallet.prepare({kind:'withdraw',config,offerId:first.offerId!},keys),/not matured/);
 await rpc('generatetoaddress',[1,miner]);await rpc('setmocktime',[(await rpc('getblockchaininfo')).mediantime+1200]);await rpc('generatetoaddress',[12,miner]);p.headerCache.clear();await p.refresh();
 await approve(await wallet.prepare({kind:'withdraw',config,offerId:first.offerId!},keys));assert.equal((await index.owned(keys[0]!.publicKey)).find(o=>o.id===first.offerId)?.status,'Finished');
await mkdir('docs/blaze2026/linked-queue',{recursive:true});await writeFile('docs/blaze2026/linked-queue/wallet-results.json',JSON.stringify({at:new Date().toISOString(),syntheticWallet:true,realBchn:true,costs,creationApprovals:3,creationFee:costs.filter(c=>c.kind==='create').reduce((n,c)=>n+Number(c.fee),0)},null,2)+'\n');
},18488,['-expire=0','-upgrade12activationheight=1']));
