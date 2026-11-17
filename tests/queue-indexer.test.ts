import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {binToHex} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {ownerAddress} from '../src/v3/protocol.js';
import {create,insert,remove,withdraw,genesis,ZERO,verify,type Parameters} from '../src/queue/protocol.js';
import {QueueIndexer,type Config} from '../src/queue/chain.js';
import {cancellationPoint} from '../src/queue/indexer.js';
test('queue indexer: canonical genesis, UTXO replacement, owner archives and independent withdrawals',{timeout:300000},async()=>isolatedRegtest(async()=>{
 const p=new RegtestElectrum(await rpc('getblockcount')),key=new SignatureTemplate(new Uint8Array(32).fill(71)),owner=ownerAddress(key.publicKey,p),miner=await rpc<string>('getnewaddress');
 async function fund(to=owner){const raw=await rpc('createrawtransaction',[[],{[to]:0.02}]),f=await rpc('fundrawtransaction',[raw,{changePosition:1}]),s=await rpc('signrawtransactionwithwallet',[f.hex]),id=await rpc('sendrawtransaction',[s.hex]);await p.refresh();return utxo(await p.transactionStatus(id),0);}
 const fee=async()=>({input:await fund(),unlocker:key.unlockP2PKH()});
 async function send(plan:ReturnType<typeof insert>|ReturnType<typeof remove>|ReturnType<typeof create>|ReturnType<typeof withdraw>){verify(plan);const [accept]=await rpc('testmempoolaccept',[[plan.raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));const id=await rpc<string>('sendrawtransaction',[plan.raw]);await p.refresh();const tx=await p.transactionStatus(id);return tx.vout.map((_:unknown,i:number)=>utxo(tx,i));}
 const params:Parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
 const created=create(params,await fund(genesis(params,key.publicKey,p).address),await fee(),[],key,p),c=created.context,[v,r]=await send(created);
 const config:Config={parameters:params,identity:c.identity,anchor:{genesis:(await p.transactionStatus(v!.txid)).txid,creator:binToHex(key.publicKey)}},index=new QueueIndexer(p,config);
 assert.equal((await index.sync()).ordered.length,0);
 const a=insert(c,v!,r!,{stake:10000n,duration:512,reward:2000n},key,[await fee()]),[v1,,a0]=await send(a);
 const b=insert(c,a0!,undefined,{stake:8000n,duration:512,reward:2000n},key,[await fee()]),[a1,b0]=await send(b);
 const stale=remove(c,a1!,b0!,1,await fee(),key);
 const d=insert(c,b0!,undefined,{stake:5000n,duration:512,reward:2000n},key,[await fee()]),[b1]=await send(d);
 const current=await index.sync();assert.deepEqual(current.ordered.map(o=>o.id),[a.offer.id,b.offer.id,d.offer.id]);assert.equal(cancellationPoint(current,b.offer.id).node.txid,b1!.txid);
 const [rejected]=await rpc('testmempoolaccept',[[stale.raw]]);assert.equal(rejected.allowed,false,'old signed node outpoint remains a conflict');
 const [a2]=await send(remove(c,a1!,b1!,1,await fee(),key));
 const [, ,locked]=await send(remove(c,v1!,a2!,2,await fee(),undefined,undefined,undefined,params.epoch+params.interval*20+1));
 const archive=await index.owned(binToHex(key.publicKey));assert.equal(archive.find(o=>o.id===a.offer.id)?.status,'Baked');assert.equal(archive.find(o=>o.id===b.offer.id)?.status,'Cancelled');assert.equal(archive.find(o=>o.id===d.offer.id)?.status,'Waiting');
 assert.equal((await index.owned(binToHex(new SignatureTemplate(new Uint8Array(32).fill(72)).publicKey))).length,0);
 await rpc('generatetoaddress',[1,miner]);await rpc('setmocktime',[(await rpc('getblockchaininfo')).mediantime+1200]);await rpc('generatetoaddress',[12,miner]);p.headerCache.clear();await p.refresh();
 await send(withdraw(c,a.offer,locked!,key,await fee()));assert.equal((await index.owned(binToHex(key.publicKey))).find(o=>o.id===a.offer.id)?.status,'Finished');
 p.unavailable.add(p.endpoints[1]!);await assert.rejects(()=>index.sync(),/second verified|Waiting|synchroniz/);p.unavailable.clear();assert.equal((await index.sync()).ordered.length,1);
},18478,['-expire=0','-upgrade12activationheight=1']));
