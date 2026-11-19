/** Synthetic keys and isolated BCHN only. The optional baseline module is a
 * byte-for-byte copy of the checkout's HEAD wallet, supplied by the benchmark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,Network} from 'cashscript';
import {binToHex,hexToBin} from '@bitauth/libauth';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {walletAddress,type WalletKey} from '../src/transactions-core.js';
import {ZERO} from '../src/queue/protocol.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {rpc} from '../src/rpc.js';
const baseline=process.env.QUEUE_BASELINE_MODULE?await import(process.env.QUEUE_BASELINE_MODULE):undefined;
test('progressive discovery: independent fresh inputs, bounded expansion and comparable latency',{timeout:480000},async()=>isolatedRegtest(async()=>{
 const results:unknown[]=[];
 for(const network of [Network.MAINNET,Network.CHIPNET]){
  const keys:WalletKey[]=Array.from({length:40},(_,index)=>({path:'receive',index,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(index+1)).publicKey)}));
  const p=new RegtestElectrum(await rpc('getblockcount'));p.network=network;let requests=0,active=0,maximum=0;
  const candidate=p.getUtxoCandidates.bind(p),request=p.request;
  p.request=async(method,...args)=>{
   requests++;
   if(method==='blockchain.relayfee')return 0.00001;
   if(method!=='blockchain.scripthash.listunspent')return request(method,...args);
   active++;maximum=Math.max(maximum,active);
   try{await new Promise(r=>setTimeout(r,5));return await request(method,...args);}finally{active--;}
  };
  const parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:600,releases:8,cap:1200n};
  async function fund(index:number){const address=walletAddress(hexToBin(keys[index]!.publicKey),'regtest'),raw=await rpc('createrawtransaction',[[],{[address]:0.03}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]);await rpc('sendrawtransaction',[signed.hex]);await p.refresh();}
  await fund(0);await fund(0);await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);p.headerCache.clear();await p.refresh();
  async function run(ctor:typeof QueueWallet,initial:boolean){const saved=new Map<string,Operation>(),w=new ctor(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}});const scope=crypto.randomUUID(),current=ctor===QueueWallet;
   if(current)await w.warmDiscovery(keys.slice(0,2),scope);
   const start=performance.now(),before=requests;
   const op=await w.prepare({kind:'create',parameters},initial?keys.slice(0,2):keys,undefined,undefined,current?scope:undefined,current,current);assert.equal(op.quote?.approvals,1);await w.authorize(op.id);
   return {milliseconds:performance.now()-start,requests:requests-before,addresses:initial?2:40};
  }
  const before:Awaited<ReturnType<typeof run>>[]=[],after:typeof before=[];
  for(let i=0;i<(baseline?3:1);i++){if(baseline)before.push(await run(baseline.QueueWallet,true));after.push(await run(QueueWallet,true));}
  const summary=(rows:typeof before)=>{const latency=rows.map(r=>r.milliseconds).sort((a,b)=>a-b);return {runs:rows.length,medianMs:latency[Math.floor(latency.length/2)],p95Ms:latency[Math.ceil(latency.length*.95)-1],medianRequests:rows.map(r=>r.requests).sort((a,b)=>a-b)[Math.floor(rows.length/2)],addresses:rows[0]?.addresses};};
  results.push({network,scenario:'origins in initial addresses',before:summary(before),after:summary(after),samples:{before,after},maximumConcurrentAddressReads:maximum});
  assert.ok(maximum>=2&&maximum<=4,'address lookups are bounded concurrent reads');
  // Discover late funding without re-querying empty early addresses. Every
  // returned coin is independently re-read, so stale candidates cannot sign.
  const late=[{...keys[39]!,index:0},...keys.slice(1,39)];await fund(22);await fund(23);await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);p.headerCache.clear();await p.refresh();
  const lateBefore:Awaited<ReturnType<typeof run>>[]=[],lateAfter:typeof lateBefore=[];
  async function lateRun(ctor:typeof QueueWallet,optimized:boolean){
   const saved=new Map<string,Operation>(),w=new ctor(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}}),start=performance.now(),before=requests,scope=crypto.randomUUID();let addresses=0;
   for(const limit of [2,8,16,24,32,40]){addresses=limit;let op:Operation;try{op=await w.prepare({kind:'create',parameters},late.slice(0,limit),undefined,undefined,scope,optimized&&limit<40,optimized&&limit===2);}catch(error){if(limit===40)throw error;continue;}
    if(op.quote?.transactions===1){await w.authorize(op.id);return {milliseconds:performance.now()-start,requests:requests-before,addresses};}await w.discard(op.id);
   }throw Error('No atomic plan found');
  }
  for(let i=0;i<(baseline?3:1);i++){if(baseline)lateBefore.push(await lateRun(baseline.QueueWallet,false));lateAfter.push(await lateRun(QueueWallet,true));}
  results.push({network,scenario:'origins first found at indices 22 and 23',before:summary(lateBefore),after:summary(lateAfter),samples:{before:lateBefore,after:lateAfter}});
  const saved=new Map<string,Operation>(),w=new QueueWallet(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}});
  let avoided=0;p.onTiming=t=>{avoided+=t.repeatedRequestsAvoided??0;};
  const scope='progressive-test';await assert.rejects(()=>w.prepare({kind:'create',parameters},late.slice(0,2),undefined,undefined,scope),/funding/);
  const op=await w.prepare({kind:'create',parameters},late.slice(0,26),undefined,undefined,scope);assert.ok(avoided>=4);await w.authorize(op.id);
  // Ordinary extensions refresh selected-input evidence without invalidating consent.
  await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);p.headerCache.clear();await p.refresh();await w.authorize(op.id);
  // A stale discovery candidate is never accepted as a live input.
  p.getUtxoCandidates=async()=>[];
  await assert.rejects(()=>w.authorize(op.id));await assert.rejects(()=>w.beginSigning(op.id),/Fresh/);p.getUtxoCandidates=candidate;
 }
 if(process.env.QUEUE_DISCOVERY_RESULTS)await writeFile(process.env.QUEUE_DISCOVERY_RESULTS,JSON.stringify({at:new Date().toISOString(),environment:'isolated BCHN regtest; public application configurations; synthetic keys; confirmed funding; 5ms injected per-address delay; no user confirmation or physical Cashonize latency',results},null,2)+'\n');
},18638,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
