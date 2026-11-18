/** Complete synthetic user-action costs, including all genesis preparations.
 * Each row uses a new public key and real isolated BCHN standard policy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {ownerAddress} from '../src/v3/protocol.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';
import {ZERO} from '../src/queue/protocol.js';
test('queue performance: full user actions for all five asset pairs',{timeout:600000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {override async sendRawTransaction(raw:string){const [accepted]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accepted.allowed,true,JSON.stringify(accepted));const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;}}
 const p=new Local(await rpc('getblockcount')),miner=await rpc<string>('getnewaddress'),request=p.request;
 let requests=0;p.request=async(method,...args)=>{requests++;return method==='blockchain.relayfee'?0.00001:request(method,...args);};
 const rows=[];
 for(const pair of ['bch/bch','bch/token','token/bch','token/token','same-token']){
  const key=new SignatureTemplate(new Uint8Array(32).fill(90+rows.length)),address=ownerAddress(key.publicKey,p),keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}],saved=new Map<string,Operation>(),wallet=new QueueWallet(p,{list:async()=>structuredClone([...saved.values()]),save:async op=>{saved.set(op.id,structuredClone(op));}});
  async function funding(token:boolean){
   const raw=await rpc('createrawtransaction',[[],{[address]:0.2}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]),id=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();const source=utxo(await p.transactionStatus(id),0);
   // Token fixture setup is separate from the atomic application operation. Token minting
   // here is fixture setup and is excluded from application action costs.
   const b=new TransactionBuilder({provider:p}).addInput(source,key.unlockP2PKH()).addOutput({to:miner,amount:546n});
   if(token)b.addOutput({to:address,amount:1200n,token:{category:id,amount:1000000n}});
   b.addOutput({to:address,amount:source.satoshis-1546n-(token?1200n:0n)});
   await rpc('sendrawtransaction',[b.build()]);await p.refresh();return id;
  }
  let stake=ZERO,reward=ZERO;
  if(pair==='bch/bch')await funding(false);
  else {const token=await funding(true);if(pair.startsWith('token')||pair==='same-token')stake=token;if(pair.endsWith('token')||pair==='same-token')reward=pair==='token/token'?await funding(true):token;}
  const actions:{kind:string;step:string;bytes:number;fee:number;approvals:number;prepareMs:number;authorizeMs:number;signatureToPendingMs:number;prepareCalls:number;authorizeCalls:number;signatureToPendingCalls:number}[]=[];
  function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const s=plan.request.sourceOutputs[i]!,sig=key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:s.contract?.redeemScript??s.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=s.contract?hexToBin(binToHex(s.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}return binToHex(encodeTransaction(tx));}
  async function act(prepare:()=>Promise<Operation>){
   let start=performance.now(),calls=requests;const op=await prepare(),prepareMs=performance.now()-start,prepareCalls=requests-calls;
   start=performance.now();calls=requests;const authorized=await wallet.authorize(op.id),authorizeMs=performance.now()-start,authorizeCalls=requests-calls;
   // Authorization must preserve the reviewed body, including the fee.
   assert.deepEqual(authorized.plan,op.plan);await wallet.beginSigning(op.id);const raw=sign(authorized.plan);
   start=performance.now();calls=requests;await wallet.retain(op.id,raw);const pending=await wallet.broadcast(op.id);
   actions.push({kind:op.intent.kind,step:op.step,bytes:raw.length/2,fee:Number(op.plan.fee),approvals:1,prepareMs,authorizeMs,signatureToPendingMs:performance.now()-start,prepareCalls,authorizeCalls,signatureToPendingCalls:requests-calls});return pending;
  }
  // Two independent ordinary output-zero coins, already in the wallet.
  for(let i=0;i<2;i++){const raw=await rpc('createrawtransaction',[[],{[address]:0.03}]),f=await rpc('fundrawtransaction',[raw,{changePosition:1}]),s=await rpc('signrawtransactionwithwallet',[f.hex]);await rpc('sendrawtransaction',[s.hex]);}await p.refresh();
  const parameters={stakingCategory:stake,rewardCategory:reward,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
  let creation=await act(()=>wallet.prepare({kind:'create',parameters},keys));assert.equal(creation.step,'action');assert.equal(actions.length,1);
  const config=creation.config!;
  const first=await act(()=>wallet.prepare({kind:'insert',config,terms:{stake:10000n,duration:512,reward:2000n}},keys));
  const second=await act(()=>wallet.prepare({kind:'insert',config,terms:{stake:8000n,duration:512,reward:2000n}},keys));
  if(process.env.QUEUE_ATOMIC_ONLY!=='1'){
  await act(()=>wallet.prepare({kind:'cancel',config,offerId:second.offerId!},keys));
  await act(()=>wallet.prepare({kind:'claim',config,expectedHead:first.offerId},keys));
  await rpc('generatetoaddress',[1,miner]);await rpc('setmocktime',[(await rpc('getblockchaininfo')).mediantime+1200]);await rpc('generatetoaddress',[12,miner]);p.headerCache.clear();await p.refresh();
  await act(()=>wallet.prepare({kind:'withdraw',config,offerId:first.offerId!},keys));
  }
  console.log('Verified atomic wallet asset pair:',pair);
  rows.push({pair,actions,creationFee:actions.filter(a=>a.kind==='create').reduce((n,a)=>n+a.fee,0),creationApprovals:actions.filter(a=>a.kind==='create').length});
 }
 if(process.env.QUEUE_PERFORMANCE_RESULTS)await writeFile(process.env.QUEUE_PERFORMANCE_RESULTS,JSON.stringify({at:new Date().toISOString(),method:'Synthetic Schnorr wallet; isolated standard-policy BCHN. Electrum facade request calls include header cache hits and exclude direct fixture BCHN RPC. Timings are single local samples, not real wallet or public-network latency.',rows},null,2)+'\n');
},18508,['-expire=0','-upgrade12activationheight=1']));
