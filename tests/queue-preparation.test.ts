/** Public network configurations run exclusively through an isolated BCHN RPC
 * facade and a loopback P2P peer. No public Electrum transport can be opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Network,SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,cashAddressToLockingBytecode,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {queueRelayPeer} from './fixtures/queue-relay-peer.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {walletAddress,type WalletKey} from '../src/transactions-core.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {ZERO,ownerScript} from '../src/queue/protocol.js';
import {QueueIndexer} from '../src/queue/chain.js';
test('automatic preparation: both public configurations, minimal approvals, recovery, exact fees and isolated P2P',{timeout:600000},async()=>isolatedRegtest(async()=>{
 const relay=await queueRelayPeer();let mocked=1790000000;await relay.peer('setmocktime',[mocked]);const results:unknown[]=[];let seed=100;
 try{
 for(const network of [Network.MAINNET,Network.CHIPNET])for(const scenario of process.env.QUEUE_PREPARATION_SCENARIOS?.split(',')??['normal','one-independent','zero','one-only','bch/token','token/bch','token/token','same-token','token-only','reported-layout']){
  console.log('Testing',network,scenario);
  class Local extends RegtestElectrum {
   lose=false;broadcasts=0;
   override async sendRawTransaction(raw:string){
    const [accept]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accept.allowed,true,JSON.stringify(accept));
    const id=await rpc<string>('sendrawtransaction',[raw]);this.broadcasts++;await this.refresh();
    await relay.until(async()=>{if((await relay.peer('getrawmempool')).includes(id))return true;mocked+=2;await rpc('setmocktime',[mocked]);await relay.peer('setmocktime',[mocked]);return false;},'preparation/creation '+scenario);
    if(this.lose){this.lose=false;throw Error('Lost acknowledgement');}return id;
   }
  }
  const p=new Local(await rpc('getblockcount'));p.network=network;const request=p.request;
  const rate=network===Network.MAINNET?2n:1n;let advertised=rate;p.request=async(method,...args)=>method==='blockchain.relayfee'?Number(advertised)/100000:request(method,...args);
  const signer=new SignatureTemplate(new Uint8Array(32).fill(seed++)),key:WalletKey={publicKey:binToHex(signer.publicKey),path:'receive',index:0},keys=[key],saved=new Map<string,Operation>();
  const store={list:async()=>structuredClone([...saved.values()]),save:async(op:Operation)=>{saved.set(op.id,structuredClone(op));}};
  let wallet=new QueueWallet(p,store);let approvals=0;
  const addr=walletAddress(signer.publicKey,'regtest'),miner=await rpc<string>('getnewaddress');const decodedMiner=cashAddressToLockingBytecode(miner);if(typeof decodedMiner==='string')throw Error(decodedMiner);const minerScript=decodedMiner.bytecode;
  async function fund(origin:boolean){const raw=await rpc('createrawtransaction',[[],{[addr]:0.03}]),f=await rpc('fundrawtransaction',[raw,{changePosition:1}]),s=await rpc('signrawtransactionwithwallet',[f.hex]),id=await rpc<string>('sendrawtransaction',[s.hex]);await p.refresh();const coin=utxo(await p.transactionStatus(id),0);if(origin)return coin;
   const b=new TransactionBuilder({provider:p}).addInput(coin,signer.unlockP2PKH()).addOutput({to:minerScript,amount:546n}).addOutput({to:ownerScript(signer.publicKey),amount:coin.satoshis-1546n});
   await rpc('sendrawtransaction',[b.build()]);await p.refresh();return coin;
  }
  async function token(only=false){const c=await fund(true),b=new TransactionBuilder({provider:p}).addInput(c,signer.unlockP2PKH()).addOutput({to:minerScript,amount:546n}).addOutput({to:ownerScript(signer.publicKey),amount:only?c.satoshis-1546n:2000n,token:{category:c.txid,amount:1000000n}});if(!only)b.addOutput({to:ownerScript(signer.publicKey),amount:c.satoshis-3546n});await rpc('sendrawtransaction',[b.build()]);await p.refresh();return c.txid;}
  let stake=ZERO,reward=ZERO;
  if(scenario==='reported-layout'){
   const a=await fund(true),b=await fund(true);
   await rpc('sendrawtransaction',[new TransactionBuilder({provider:p}).addInput(a,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:1200n}).addOutput({to:ownerScript(signer.publicKey),amount:865001n}).addOutput({to:minerScript,amount:a.satoshis-867201n}).build()]);
   await rpc('sendrawtransaction',[new TransactionBuilder({provider:p}).addInput(b,signer.unlockP2PKH()).addOutput({to:minerScript,amount:546n}).addOutput({to:ownerScript(signer.publicKey),amount:1500n}).addOutput({to:minerScript,amount:b.satoshis-3046n}).build()]);await p.refresh();
  }else if(scenario==='normal'){await fund(true);await fund(true);}
  else if(scenario==='one-independent'){await fund(true);await fund(false);}
  else if(scenario==='one-only')await fund(true);
  else if(scenario==='zero')await fund(false);
  else if(scenario==='token-only'){reward=await token(true);}
  else {const a=await token();if(scenario.startsWith('token')||scenario==='same-token')stake=a;if(scenario.endsWith('token')||scenario==='same-token')reward=scenario==='token/token'?await token():a;}
  const parameters={stakingCategory:stake,rewardCategory:reward,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:600,releases:scenario==='reported-layout'?8:20,cap:scenario==='reported-layout'?1200n:2000n};
  let op=await wallet.prepare({kind:'create',parameters},keys);const quote=op.quote!,expected=scenario==='normal'?1:['one-independent','reported-layout'].includes(scenario)?2:3;
  if(scenario==='reported-layout')assert.equal(BigInt(quote.walletDebit),13000n+BigInt(quote.totalFee));
  assert.equal(quote.transactions,expected,network+' '+scenario);assert.equal(quote.approvals,expected);assert.equal(approvals,0);assert.equal(p.broadcasts,0);
  if(expected>1){await assert.rejects(()=>wallet.authorize(op.id),/Confirm additional/);await wallet.discard(op.id);assert.equal(p.broadcasts,0);op=await wallet.prepare({kind:'create',parameters},keys);await wallet.confirm(op.id);}
  const measured:{bytes:number;fee:string;step:string}[]=[];
  while(true){
   if(!op.approved)op=await wallet.confirm(op.id);
   const auth=await wallet.authorize(op.id);await wallet.beginSigning(op.id);await assert.rejects(()=>wallet.beginSigning(op.id),/Fresh/);
   // Explicit refusal permits a reviewed retry; uncertainty never does.
   if(approvals===0&&expected>1){await wallet.signingFailed(op.id,true);op=await wallet.resume(op.id,keys);if(!op.approved)await wallet.confirm(op.id);await wallet.authorize(op.id);await wallet.beginSigning(op.id);}
   const tx=structuredClone(auth.plan.request.transaction) as Transaction;
   for(const [i]of auth.plan.inputPaths){const sig=signer.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:auth.plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:auth.plan.request.sourceOutputs[i]!.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=new Uint8Array([...encodeDataPush(sig),...encodeDataPush(signer.publicKey)]);}
   const raw=binToHex(encodeTransaction(tx));approvals++;await wallet.retain(op.id,raw);measured.push({step:op.step,bytes:raw.length/2,fee:op.plan.fee!});assert.equal(BigInt(raw.length/2)*rate,BigInt(op.plan.fee!));
   if(approvals===1&&expected>1){p.lose=true;await assert.rejects(()=>wallet.broadcast(op.id),/Lost acknowledgement/);wallet=new QueueWallet(p,store);op=await wallet.resume(op.id,keys);assert.equal(op.stage,'pending');assert.equal(approvals,1);}
   else op=await wallet.broadcast(op.id);
   if(op.step==='action')break;
   if(approvals===1){await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();wallet=new QueueWallet(p,store);}
   if(scenario==='one-independent'){
    advertised=rate+1n;const changed=await wallet.advance(op.id,keys);assert.equal(changed.approved,false);await assert.rejects(()=>wallet.authorize(changed.id),/Confirm additional/);advertised=rate;
   }
   if(scenario==='reported-layout'&&approvals===1){
    const broadcasts:number=p.broadcasts;
    await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),(e:any)=>{assert.equal(e.details.available,'1500');assert.ok(BigInt(e.details.reserved)>800000n);assert.match(e.message,/confirmation alone does not release/);return true;});assert.equal(p.broadcasts,broadcasts,'another creation cannot consume reserved self-send outputs');
   }
   const child=await wallet.advance(op.id,keys),same=await wallet.advance(op.id,keys);assert.equal(child.id,same.id,'no duplicate continuation');op=same;
  }
  assert.equal(approvals,expected);assert.equal(p.broadcasts,expected);assert.equal(measured.reduce((n,c)=>n+BigInt(c.fee),0n).toString(),quote.totalFee);
  assert.notEqual(op.config!.identity.vault,op.config!.identity.queue);assert.equal((await new QueueIndexer(p,op.config!).sync()).state.reserve,parameters.cap*BigInt(parameters.releases));
  const wrong={...op,network:network===Network.MAINNET?Network.CHIPNET:Network.MAINNET};saved.set(op.id,wrong);await assert.rejects(()=>wallet.get(op.id),/network mismatch/);saved.set(op.id,op);
  console.log('Verified',network,scenario,expected,'transactions/approvals');
  results.push({network,scenario,transactions:expected,approvals,quote,measured,p2pRelayed:true});
 }
 await writeFile(process.env.QUEUE_PREPARATION_RESULTS??'docs/blaze2026/linked-queue/preparation-results.json',JSON.stringify({at:new Date().toISOString(),environment:'isolated BCHN regtest with mainnet/chipnet application configuration and loopback P2P; synthetic Schnorr signer; no public broadcast or real Cashonize',results},null,2)+'\n');
 }finally{await relay.close();}
},18538,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
