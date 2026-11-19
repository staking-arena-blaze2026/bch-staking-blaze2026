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
  const facade=p.request,counts:Record<string,number>={};let absent:string|undefined;
  p.request=async(method,...args)=>{
   counts[method]=(counts[method]??0)+1;
   if(method==='blockchain.relayfee')return 0.00001;
   if(method==='blockchain.scripthash.listunspent'){
    await new Promise(resolve=>setTimeout(resolve,5));
    return (await facade(method,...args)).filter((row:{tx_hash:string})=>row.tx_hash!==absent);
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
  async function review(wallet:QueueWallet,cached:boolean){
   const op=await wallet.prepare(intent,keys,undefined,undefined,cached?id:undefined,false,cached);
   assert.equal(op.step,'action');assert.equal(op.quote,undefined);
   if(stakingCategory!==ZERO){
    assert.ok(op.sources.some(c=>c.token?.category===stakingCategory&&c.token.amount>=intent.terms.stake));
    assert.ok(op.sources.some(c=>!c.token&&c.lockingBytecode===script),'BCH pays network fees');
   }
   await wallet.authorize(op.id);await wallet.beginSigning(op.id);return op;
  }
  const old=baseline?await measure(()=>review(new baseline.QueueWallet(p,makeStore()),false)):undefined;
  const cold=await measure(()=>review(first,true));await first.signingFailed(cold.result.id,true);await first.discard(cold.result.id);
  const saved=structuredClone(first.discoverySnapshot(id));
  assert.equal(repeat.restoreDiscovery(id,saved.scope,Object.fromEntries(saved.evidence))[0]?.publicKey,publicKey);
  const warm=await measure(()=>review(repeat,true));await repeat.signingFailed(warm.result.id,true);await repeat.discard(warm.result.id);
  assert.deepEqual(warm.result.sources,cold.result.sources);
  assert.ok(warm.methods['blockchain.scripthash.listunspent']!<cold.methods['blockchain.scripthash.listunspent']!,'repeat discovery avoids known address reads');
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
  const creatingCache=structuredClone(firstCreation.discoverySnapshot(id));
  repeatCreation.restoreDiscovery(id,creatingCache.scope,Object.fromEntries(creatingCache.evidence));
  const repeatCreating=await measure(()=>createReview(repeatCreation));
  assert.ok(repeatCreating.methods['blockchain.scripthash.listunspent']!<firstCreating.methods['blockchain.scripthash.listunspent']!);
  const stats=({milliseconds,methods}:typeof warm)=>({milliseconds,methods});
  results.push({network,stakingAsset:stakingCategory===ZERO?'BCH':'CashToken',baseline:old&&stats(old),first:stats(cold),repeat:stats(warm),create:{first:stats(firstCreating),repeat:stats(repeatCreating)}});
 }
 if(process.env.QUEUE_SHARED_RESULTS)await writeFile(process.env.QUEUE_SHARED_RESULTS,JSON.stringify({results},null,2)+'\n');
},18688,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
