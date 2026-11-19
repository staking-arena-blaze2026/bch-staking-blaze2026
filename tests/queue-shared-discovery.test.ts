import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Network,SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex} from '@bitauth/libauth';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {walletAddress,type WalletKey} from '../src/transactions-core.js';
import {ZERO,create,ownerScript} from '../src/queue/protocol.js';
import {addAnnouncement} from '../src/queue/discovery.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
const baseline=process.env.QUEUE_BASELINE_MODULE?await import(process.env.QUEUE_BASELINE_MODULE):undefined;

test('persistent discovery shares funding between creation and BCH/token offers, with fresh input and queue checks',{timeout:360000},async()=>isolatedRegtest(async()=>{
 const results=[];
 for(const network of [Network.MAINNET,Network.CHIPNET]){
  const p=new RegtestElectrum(await rpc('getblockcount'));p.network=network;
  const signer=new SignatureTemplate(new Uint8Array(32).fill(network===Network.MAINNET?93:94)),publicKey=binToHex(signer.publicKey),key:WalletKey={path:'receive',index:0,publicKey};
  const keys=[key,...[1,2,3,4,5,6,7].map(index=>({path:'receive' as const,index,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(94+index)).publicKey)}))];
  const address=walletAddress(signer.publicKey,'regtest'),miner=await rpc<string>('getnewaddress'),script=binToHex(ownerScript(signer.publicKey));
  const facade=p.request,counts:Record<string,number>={};let absent:string|undefined,fee=1,misreport=false;
  const touched=new Set<string>();
  p.request=async(method,...args)=>{
   counts[method]=(counts[method]??0)+1;
   touched.add(p.endpoint!);
   if(method==='blockchain.relayfee')return fee/100000;
   if(method==='blockchain.scripthash.listunspent'){
    await new Promise(resolve=>setTimeout(resolve,5));
    return (await facade(method,...args)).filter((row:{tx_hash:string})=>row.tx_hash!==absent).map((row:{value:number;tx_hash:string})=>misreport&&row.value===800000?{...row,value:row.value+100}:row);
   }
   return facade(method,...args);
  };
  async function fund(sats=400000){
   const raw=await rpc('createrawtransaction',[[],{[address]:sats/1e8}]),f=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[f.hex]);
   const id=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();return utxo(await p.transactionStatus(id),0);
  }
  let stakingCategory=ZERO;
  if(network===Network.CHIPNET){
   const source=await fund();stakingCategory=source.txid;
   const token=new TransactionBuilder({provider:p}).addInput(source,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:1200n,token:{category:stakingCategory,amount:1000000n}}).addOutput({to:ownerScript(signer.publicKey),amount:source.satoshis-2200n});
   await rpc('sendrawtransaction',[token.build()]);await p.refresh();
  }
  const parameters={stakingCategory,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:600,releases:8,cap:2000n};
  const a=await fund(),b=await fund(),genesis=create(parameters,{input:a,unlocker:signer.unlockP2PKH()},{input:b,unlocker:signer.unlockP2PKH()},[],signer,p,1n,{cost:1000n,add:(builder,c)=>addAnnouncement(builder,p,{parameters,creator:publicKey,queue:c.identity.queue})});
  const genesisId=await rpc<string>('sendrawtransaction',[genesis.raw]);
  await fund(800000);await fund(600000);await fund(20000);
  await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
  const config={parameters,identity:genesis.context.identity,anchor:{creator:publicKey,genesis:genesisId}};
  const intent={kind:'insert' as const,config,terms:{stake:10000n,duration:512,reward:2000n}};
  const makeStore=()=>{
   const saved=new Map<string,Operation>();
   return {list:async()=>structuredClone([...saved.values()]),save:async(op:Operation)=>{saved.set(op.id,structuredClone(op));}};
  };
  const store=makeStore(),id='a'.repeat(64),first=new QueueWallet(p,store),repeat=new QueueWallet(p,store);
  async function measure<T>(run:()=>Promise<T>){
   const start=performance.now(),before={...counts},result=await run();
   return {result,milliseconds:performance.now()-start,methods:Object.fromEntries(Object.entries(counts).map(([method,count])=>[method,count-(before[method]??0)]))};
  }
  const quoteTimings:{milliseconds:number;listunspent:number}[]=[];
  async function review(wallet:QueueWallet,cached:boolean,quotes=true){
   const start=structuredClone(await store.list()),before={...counts};touched.clear();
   const startQuote=performance.now();
   const quote=quotes?await wallet.previewAction(intent,keys,id,true):undefined;
   if(quote){
    quoteTimings.push({milliseconds:performance.now()-startQuote,listunspent:(counts['blockchain.scripthash.listunspent']??0)-(before['blockchain.scripthash.listunspent']??0)});
    assert.equal(touched.size,1);assert.ok(p.endpoints.includes([...touched][0]!));
    for(const method of ['blockchain.transaction.get','blockchain.transaction.get_merkle','blockchain.scripthash.get_history'])assert.equal(counts[method]??0,before[method]??0);
    assert.deepEqual(await store.list(),start);
    assert.equal(quote.asset,stakingCategory);assert.equal(quote.amount,'10000');
   }
   const op=await wallet.prepare(intent,keys,undefined,undefined,cached?id:undefined,false,cached&&!quote,undefined,quote?.commitment);
   assert.equal(op.step,'action');assert.equal(op.quote,undefined);
   if(quote){assert.equal(op.actionQuote?.commitment,quote.commitment);assert.equal(op.approved,true);}
   if(stakingCategory!==ZERO){
    assert.ok(op.sources.some(c=>c.token?.category===stakingCategory&&c.token.amount>=intent.terms.stake));
    assert.ok(op.sources.some(c=>!c.token&&c.lockingBytecode===script),'BCH pays network fees');
   }
   await wallet.authorize(op.id);await wallet.beginSigning(op.id);return op;
  }
  const old=baseline?await measure(()=>review(new baseline.QueueWallet(p,makeStore()),true,false)):undefined;
  const cold=await measure(()=>review(first,true));await first.signingFailed(cold.result.id,true);await first.discard(cold.result.id);
  let saved=structuredClone(first.discoverySnapshot(id));
  if(saved.scope!.expires<Date.now()){
   await first.warmDiscovery(keys,id);
   saved=structuredClone(first.discoverySnapshot(id,true));
  }
  assert.equal(repeat.restoreDiscovery(id,saved.scope,Object.fromEntries(saved.evidence))[0]?.publicKey,publicKey);
  const warm=await measure(()=>review(repeat,true));await repeat.signingFailed(warm.result.id,true);await repeat.discard(warm.result.id);
  assert.deepEqual(warm.result.sources,cold.result.sources);
  assert.ok(warm.methods['blockchain.scripthash.listunspent']!<cold.methods['blockchain.scripthash.listunspent']!,'repeat discovery avoids known address reads');
  const otherScope='b'.repeat(64);
  touched.clear();
  p.unavailable.add(p.endpoints[0]!);
  const failover=await repeat.previewAction(intent,keys,otherScope,true);
  assert.deepEqual([...touched],[p.endpoints[1]]);
  assert.equal(failover.commitment,warm.result.actionQuote?.commitment);
  p.unavailable.clear();
  p.unresolvedChainPeers.add(p.endpoints[0]!);
  await assert.rejects(()=>repeat.previewAction(intent,keys,otherScope),/Conflicting blockchain evidence/);
  p.unresolvedChainPeers.clear();
  fee=2;
  const repriced=await repeat.prepare(intent,keys,undefined,undefined,otherScope,false,false,undefined,failover.commitment);
  assert.equal(repriced.approved,false);assert.ok(BigInt(repriced.actionQuote!.fee)>BigInt(failover.fee));
  await assert.rejects(()=>repeat.authorize(repriced.id),/Confirm updated costs/);
  await repeat.discard(repriced.id);fee=1;
  misreport=true;
  const fabricated=await repeat.previewAction(intent,keys,'fabricated',true);
  misreport=false;
  const real=await repeat.prepare(intent,keys,undefined,undefined,'truth',false,true,undefined,fabricated.commitment);
  assert.equal(real.approved,false,'fabricated amount cannot authorize a matching fee or wallet debit');
  await assert.rejects(()=>repeat.beginSigning(real.id),/Fresh/);
  await repeat.discard(real.id);
  const switched=await repeat.prepare({kind:'create',parameters},keys,undefined,undefined,id,true,true);
  assert.equal(switched.quote?.approvals,1);
  await repeat.discard(switched.id);
  const stale=await repeat.prepare(intent,keys,undefined,undefined,id,false,true);
  absent=stale.sources.find(u=>u.lockingBytecode===script)!.txid;
  await assert.rejects(()=>repeat.authorize(stale.id));await assert.rejects(()=>repeat.beginSigning(stale.id),/Fresh/);
  await repeat.discard(stale.id);absent=undefined;
  await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
  const changed=await measure(()=>review(repeat,true));assert.ok(changed.methods['blockchain.scripthash.listunspent']!>=warm.methods['blockchain.scripthash.listunspent']!);
  const creationStore=makeStore(),firstCreation=new QueueWallet(p,creationStore),repeatCreation=new QueueWallet(p,creationStore);
  async function createReview(wallet:QueueWallet){
   const op=await wallet.prepare({kind:'create',parameters},keys,undefined,undefined,id,true,true);
   assert.equal(op.quote?.approvals,1);
   await wallet.authorize(op.id);await wallet.beginSigning(op.id);return op;
  }
  const firstCreating=await measure(()=>createReview(firstCreation));
  await firstCreation.signingFailed(firstCreating.result.id,true);await firstCreation.discard(firstCreating.result.id);
  let creatingCache=structuredClone(firstCreation.discoverySnapshot(id));
  if(creatingCache.scope!.expires<Date.now()){
   await firstCreation.warmDiscovery(keys,id);
   creatingCache=structuredClone(firstCreation.discoverySnapshot(id,true));
  }
  repeatCreation.restoreDiscovery(id,creatingCache.scope,Object.fromEntries(creatingCache.evidence));
  const repeatCreating=await measure(()=>createReview(repeatCreation));
  assert.ok(repeatCreating.methods['blockchain.scripthash.listunspent']!<firstCreating.methods['blockchain.scripthash.listunspent']!);
  await repeatCreation.signingFailed(repeatCreating.result.id,true);await repeatCreation.discard(repeatCreating.result.id);
  const estimate=await repeatCreation.previewCreate(parameters,keys,id,true,true);
  absent=repeatCreating.result.sources.find(u=>u.satoshis===800000n)!.txid;
  // Use a fresh scope to model a funded source being replaced by an already
  // available, smaller origin. The fees and wallet debit are still equal.
  const changedFunding=await repeatCreation.prepare({kind:'create',parameters},keys,undefined,undefined,'changed',true,true,estimate.commitment);
  assert.deepEqual(changedFunding.quote,estimate.quote);
  assert.equal(changedFunding.approved,false);
  await assert.rejects(()=>repeatCreation.authorize(changedFunding.id),/Confirm additional/);
  absent=undefined;
  const stats=({milliseconds,methods}:typeof warm)=>({milliseconds,methods});
  results.push({network,stakingAsset:stakingCategory===ZERO?'BCH':'CashToken',baseline:old&&stats(old),first:stats(cold),repeat:stats(warm),quotes:quoteTimings,create:{first:stats(firstCreating),repeat:stats(repeatCreating)}});
 }
 if(process.env.QUEUE_SHARED_RESULTS)await writeFile(process.env.QUEUE_SHARED_RESULTS,JSON.stringify({results},null,2)+'\n');
},18688,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
