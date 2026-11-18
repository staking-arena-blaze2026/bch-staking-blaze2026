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
 let requests=0;
 p.request=async(method,...args)=>{requests++;return method==='blockchain.relayfee'?0.00001:request(method,...args);};
 const timings:{kind:string;step:string;phase:string;ms:number;requests:number}[]=[];
 async function measured<T>(kind:string,step:string,phase:string,run:()=>Promise<T>){const start=performance.now(),count=requests;try{return await run();}finally{timings.push({kind,step,phase,ms:performance.now()-start,requests:requests-count});}}
 const key=new SignatureTemplate(new Uint8Array(32).fill(73)),changeKey=new SignatureTemplate(new Uint8Array(32).fill(74)),address=ownerAddress(key.publicKey,p),miner=await rpc<string>('getnewaddress'),keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0},{publicKey:binToHex(changeKey.publicKey),path:'change',index:0}],saved=new Map<string,Operation>();
 const wallet=new QueueWallet(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}});
 const prepare=(...args:Parameters<QueueWallet['prepare']>)=>measured(args[0].kind,'prepare','prepare',()=>wallet.prepare(...args));
 const raw=await rpc('createrawtransaction',[[],{[address]:0.2}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]);await rpc('sendrawtransaction',[signed.hex]);await p.refresh();
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const signer=plan.signers?.[i]===binToHex(changeKey.publicKey)?changeKey:key,s=plan.request.sourceOutputs[i]!,sig=signer.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:s.contract?.redeemScript??s.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=s.contract?hexToBin(binToHex(s.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(signer.publicKey)]);}return binToHex(encodeTransaction(tx));}
 const costs:{kind:string;step:string;bytes:number;fee:string}[]=[];let approvals=0;
 async function approve(op:Operation){const reviewed=structuredClone(op.plan),auth=await measured(op.intent.kind,op.step,'authorize',()=>wallet.authorize(op.id));assert.deepEqual(auth.plan,reviewed,'authorization must preserve the reviewed body');approvals++;await wallet.beginSigning(op.id);const raw=sign(auth.plan);const sinceSignature=performance.now(),count=requests;await wallet.retain(op.id,raw);costs.push({kind:op.intent.kind,step:op.step,bytes:raw.length/2,fee:auth.plan.fee!});const pending=await wallet.broadcast(op.id);timings.push({kind:op.intent.kind,step:op.step,phase:'signature-to-pending',ms:performance.now()-sinceSignature,requests:requests-count});return pending;}
 // A wallet holding only nonzero outputs cannot initialize categories.
 const initialUtxos=p.getUtxosForLockingBytecode.bind(p);
 p.getUtxosForLockingBytecode=async script=>(await initialUtxos(script)).filter(u=>u.vout!==0);
 const noGenesisParams={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
 await assert.rejects(()=>prepare({kind:'create',parameters:noGenesisParams},keys),/Found 0/);assert.equal(saved.size,0);assert.equal(approvals,0);
 p.getUtxosForLockingBytecode=initialUtxos;
 const params={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
 // One/no eligible output-zero sets fail without creating a journal or broadcast.
 await assert.rejects(()=>prepare({kind:'create',parameters:params},keys),/Found 1/);assert.equal(saved.size,0);assert.equal(approvals,0);
 const more=await rpc('createrawtransaction',[[],{[ownerAddress(changeKey.publicKey,p)]:0.03}]),mf=await rpc('fundrawtransaction',[more,{changePosition:1}]),ms=await rpc('signrawtransactionwithwallet',[mf.hex]);await rpc('sendrawtransaction',[ms.hex]);await p.refresh();
 let creation=await prepare({kind:'create',parameters:params},keys);assert.equal(creation.step,'action');assert.deepEqual(creation.plan.inputPaths,[[0,'receive',0],[1,'change',0]]);await wallet.authorize(creation.id);await wallet.beginSigning(creation.id);await assert.rejects(()=>wallet.beginSigning(creation.id),/Fresh/);await wallet.signingFailed(creation.id,true);creation=await wallet.resume(creation.id,keys);creation=await approve(creation);assert.equal(approvals,1);
 const config=creation.config!,index=new QueueIndexer(p,config);const genesis=await p.transactionStatus(creation.txid!),announcement=announcementIn(genesis);assert.ok(announcement);assert.deepEqual(await resolveAnnouncement(p,genesis.txid,announcement),config);const initial=await index.sync();assert.equal(initial.ordered.length,0);assert.equal(initial.state.reserve,40000n);
 // A confirmed competing root spend invalidates the saved bytes without rewriting them.
 const stale=await prepare({kind:'insert',config,terms:{stake:7000n,duration:512,reward:2000n}},keys),staleAuth=await wallet.authorize(stale.id);
 await wallet.beginSigning(stale.id);const staleRaw=sign(staleAuth.plan);await wallet.retain(stale.id,staleRaw);
 const fundingRaw=await rpc('createrawtransaction',[[],{[address]:0.03}]),fundingTx=await rpc('fundrawtransaction',[fundingRaw,{changePosition:1}]),fundingSigned=await rpc('signrawtransactionwithwallet',[fundingTx.hex]),fundingId=await rpc<string>('sendrawtransaction',[fundingSigned.hex]);await p.refresh();
 const snap=await index.sync(),competitor=q.insert(index.context(),snap.vault,snap.root,{stake:6000n,duration:512,reward:2000n},key,[{input:(await import('../src/arena-core.js')).utxo(await p.transactionStatus(fundingId),0),unlocker:key.unlockP2PKH()}]);
 await rpc('sendrawtransaction',[competitor.raw]);await rpc('generatetoaddress',[1,miner]);await p.refresh();
 const conflicted=await wallet.resume(stale.id,keys);assert.equal(conflicted.stage,'conflict');assert.equal(conflicted.raw,staleRaw);
 // Remove the competing offer to restore the fixture's empty queue.
 await approve(await prepare({kind:'cancel',config,offerId:competitor.offer.id},keys));
 const first=await prepare({kind:'insert',config,terms:{stake:10000n,duration:512,reward:2000n}},keys),authorized=await wallet.authorize(first.id),before=approvals;
 const tampered=structuredClone(authorized.plan);(tampered.request.transaction as Transaction).outputs.at(-1)!.valueSatoshis++;await assert.rejects(()=>wallet.retain(first.id,sign(tampered)),/Wallet changed/);
 await wallet.beginSigning(first.id);
 await wallet.signingFailed(first.id,false);
 await assert.rejects(()=>wallet.authorize(first.id),/Uncertain/);
 await assert.rejects(()=>wallet.discard(first.id),/uncertain/);
 await assert.rejects(()=>wallet.resume(first.id,keys),/Signing status unknown/);
 approvals++;const firstRaw=sign(authorized.plan);await wallet.retain(first.id,firstRaw);costs.push({kind:'insert',step:'action',bytes:firstRaw.length/2,fee:authorized.plan.fee!});p.lose=true;await assert.rejects(()=>wallet.broadcast(first.id),/Lost broadcast/);assert.equal((await wallet.get(first.id)).raw,firstRaw);assert.equal((await wallet.resume(first.id,keys)).stage,'pending');assert.equal(approvals-before,1);assert.equal((await index.sync()).ordered.length,1);
 const second=await approve(await prepare({kind:'insert',config,terms:{stake:8000n,duration:512,reward:2000n}},keys));
 const cancel=await approve(await prepare({kind:'cancel',config,offerId:second.offerId!},keys));assert.equal(cancel.sources.length,3);
 const originalSync=QueueIndexer.prototype.sync;
 QueueIndexer.prototype.sync=async()=>{throw Error('Unexpected standing queue traversal');};
 try{await approve(await prepare({kind:'claim',config},keys));}finally{QueueIndexer.prototype.sync=originalSync;}
 await assert.rejects(()=>prepare({kind:'withdraw',config,offerId:first.offerId!},keys),/not matured/);
 await rpc('generatetoaddress',[1,miner]);await rpc('setmocktime',[(await rpc('getblockchaininfo')).mediantime+1200]);await rpc('generatetoaddress',[12,miner]);p.headerCache.clear();await p.refresh();
 QueueIndexer.prototype.sync=async()=>{throw Error('Unexpected standing queue traversal');};
 try{await approve(await prepare({kind:'withdraw',config,offerId:first.offerId!},keys));}finally{QueueIndexer.prototype.sync=originalSync;}assert.equal((await index.owned(keys[0]!.publicKey)).find(o=>o.id===first.offerId)?.status,'Finished');
const actionTimings=timings.slice();
 // Review evidence is bound to tip, exact intent and wallet session, and is
 // deliberately not restored as signing authority by a new wallet worker.
 let changed=await prepare({kind:'insert',config,terms:{stake:9000n,duration:512,reward:2000n}},keys);
 saved.get(changed.id)!.intent={kind:'claim',config};
 await assert.rejects(()=>wallet.authorize(changed.id),/intent or wallet session changed/);
 saved.set(changed.id,structuredClone(changed));wallet.invalidateReviews();
 await assert.rejects(()=>wallet.authorize(changed.id),/wallet session changed/);
 await wallet.discard(changed.id);
 changed=await prepare({kind:'insert',config,terms:{stake:9000n,duration:512,reward:2000n}},keys);
 await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 await assert.rejects(()=>wallet.authorize(changed.id),/Tip changed/);
 await assert.rejects(()=>wallet.beginSigning(changed.id),/Fresh queue authorization/);
 await wallet.discard(changed.id);
 changed=await prepare({kind:'insert',config,terms:{stake:9000n,duration:512,reward:2000n}},keys);
 const oldTip=await rpc<string>('getbestblockhash');await rpc('invalidateblock',[oldTip]);p.headerCache.clear();await p.refresh();
 await assert.rejects(()=>wallet.authorize(changed.id),/Tip changed|Conflicting/);
 await wallet.discard(changed.id);await rpc('reconsiderblock',[oldTip]);p.headerCache.clear();await p.refresh();
await mkdir('docs/blaze2026/linked-queue',{recursive:true});await writeFile(process.env.QUEUE_WALLET_RESULTS??'docs/blaze2026/linked-queue/wallet-results.json',JSON.stringify({at:new Date().toISOString(),syntheticWallet:true,realBchn:true,requestMethod:'Electrum facade request invocations; excludes direct BCHN RPC in the fixture and warm cache hits are counted',timings:actionTimings,costs,creationApprovals:1,creationFee:costs.filter(c=>c.kind==='create').reduce((n,c)=>n+Number(c.fee),0)},null,2)+'\n');
},18488,['-expire=0','-upgrade12activationheight=1']));
