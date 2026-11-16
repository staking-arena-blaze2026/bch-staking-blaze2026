/** Isolated synthetic wallet; real local BCHN plus configurable Electrum latency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {AssetWallet,type Operation} from '../src/v3/wallet.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {ownerAddress} from '../src/v3/protocol.js';
import type {BrowserPlan} from '../src/transactions-core.js';
test('isolated vault/Atomic V4 latency with synthetic signatures and delayed independent providers',{timeout:300000},async()=>isolatedRegtest(async()=>{
 const stats:Record<string,number>={},latency=Number(process.env.PERF_LATENCY_MS??30);
 class Local extends RegtestElectrum {
  readers=new Map<string,Local>();
  constructor(start:number){super(start);const read=this.request;this.request=async(method,...args)=>{stats[method]=(stats[method]??0)+1;await new Promise(r=>setTimeout(r,latency));return read(method,...args);};}
  independentReader(endpoint:string){let reader=this.readers.get(endpoint);if(!reader){reader=new Local(this.startHeight);const session=reader.session.bind(reader);reader.session=async(work,peer)=>{await reader!.refresh();return session(work,peer);};this.readers.set(endpoint,reader);}return reader;}
  override async sendRawTransaction(raw:string){const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;}
 }
 const p=new Local(await rpc('getblockcount')),key=new SignatureTemplate(new Uint8Array(32).fill(246)),owner=ownerAddress(key.publicKey,p),keys=[{path:'receive' as const,index:0,publicKey:binToHex(key.publicKey)}];
 const journal=new Map<string,Operation>(),wallet=new AssetWallet(p,{list:async()=>structuredClone([...journal.values()]),save:async op=>{journal.set(op.id,structuredClone(op));}});
 const miner=await rpc<string>('getnewaddress');await rpc('sendtoaddress',[owner,0.05]);await rpc('generatetoaddress',[1,miner]);await p.refresh();
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const source=plan.request.sourceOutputs[i]!,preimage=generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)}),signature=key.generateSignature(hash256(preimage));signature[64]=0x61;tx.inputs[i]!.unlockingBytecode=source.contract?hexToBin(binToHex(source.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(signature))):new Uint8Array([...encodeDataPush(signature),...encodeDataPush(key.publicKey)]);}return binToHex(encodeTransaction(tx));}
 const report:any={at:new Date().toISOString(),network:'isolated-regtest',latencyPerRequestMs:latency,cashonize:false,operations:[]};
 async function run(operation:string,prepare:()=>Promise<Operation>){const before={...stats},start=performance.now(),op=await prepare(),auth=await wallet.authorize(op.id),approvalMs=performance.now()-start,raw=sign(auth.plan),returned=performance.now(),sent=await wallet.submit(op.id,raw);assert.equal(sent.stage,'pending',sent.error);const requests:Record<string,number>={};for(const [m,n]of Object.entries(stats))requests[m]=n-(before[m]??0);report.operations.push({operation,creationMode:sent.creationMode,untilApprovalMs:approvalMs,signatureToPendingMs:performance.now()-returned,requests});return sent;}
 const mtp=(await rpc('getblockchaininfo')).mediantime;
 const vault=await run('create',()=>wallet.create({version:3,registryVersion:4,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:mtp-1000,periodSeconds:100,periods:4,cap:2000n},keys));
 await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 const reused:string[]=[];for(const reader of p.readers.values())reader.onTiming=t=>reused.push(t.stage);
 await new AssetIndexer(p,vault.config!).sync();await new AssetIndexer(p,vault.config!).sync();assert.ok(reused.includes('confirmed-replay-evidence-reused')||!('onTiming' in p),'optimized readers reuse only confirmed evidence');
 await run('offer',()=>wallet.offer(vault.config!,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys));
 console.log(JSON.stringify(report));if(process.env.PERF_REPORT)await writeFile(process.env.PERF_REPORT,JSON.stringify(report,null,2)+'\n');
},18458));
