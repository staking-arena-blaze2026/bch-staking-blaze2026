import test from 'node:test';
import {ProviderVerificationError} from '../src/verified-providers.js';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MockNetworkProvider,Network,SignatureTemplate,TransactionBuilder,type SpendableUtxo} from 'cashscript';
import {encodeTransaction,binToHex,hexToBin,type Transaction} from '@bitauth/libauth';
import {Buffer} from '../src/bytes.js';
import {decodeRawTransaction,type ElectrumCore} from '../src/electrum-core.js';
import {utxo} from '../src/arena-core.js';
import {walletScript} from '../src/transactions-core.js';
import {AssetIndexer,type Config} from '../src/v3/indexer.js';
import {directGenesisBuilder,validateGenesis,assetOutput,covenant,parameterArgs,genesisBuilder,transitionBuilder,sponsorAmount,type Asset,type Parameters,type Instance} from '../src/v3/protocol.js';

test('v3 portable Electrum replay: confirmed/pending, competing spends, provider errors and reorg recovery',async()=>{
 const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
 const key=new SignatureTemplate(new Uint8Array(32).fill(71)),pub=Buffer.from(key.publicKey).toString('hex'),script=walletScript(pub),native:Asset={kind:'bch'},a:Asset={kind:'token',category:'ac'.repeat(32)},b:Asset={kind:'token',category:'bc'.repeat(32)};
 for(const [stakingAsset,rewardAsset]of [[native,native],[native,b],[a,native],[a,b],[a,a]] as [Asset,Asset][]){
 const maximum=stakingAsset.kind==='bch'&&rewardAsset.kind==='bch';
 const p:Parameters={version:3,stakingAsset,rewardAsset,cap:maximum?1000000n:rewardAsset.kind==='bch'?2000n:10n,periods:maximum?16:3,epoch:1700000000,periodSeconds:10},txs=new Map<string,any>(),heights=new Map<string,number>();let counter=0;
 const baseTx=(outputs:Transaction['outputs'])=>binToHex(encodeTransaction({version:3,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs}));
 const add=(raw:string,height=2)=>{const tx={...decodeRawTransaction(raw),confirmations:height>0?1:0,blockhash:'dd'.repeat(32),hex:raw};txs.set(tx.txid,tx);heights.set(tx.txid,height);return tx;};
 const toOutput=(asset:Asset,amount:bigint,base=1000n)=>{const o=assetOutput(asset,amount,base);return {valueSatoshis:o.amount,lockingBytecode:hexToBin(script),...(o.token?{token:{category:hexToBin(o.token.category),amount:o.token.amount}}:{})};};
 const factory=covenant('RegistryGenesisV3',parameterArgs(p),provider),parent=add(baseTx([{valueSatoshis:12000n,lockingBytecode:hexToBin(factory.lockingBytecode)},toOutput(rewardAsset,p.cap*BigInt(p.periods))]));
 const g=genesisBuilder(p,utxo(parent,0),{input:utxo(parent,1),unlocker:key.unlockP2PKH()},provider),genesis=add(g.builder.build());
 let instance:Instance={parameters:p,category:parent.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};
 const config:Config={...p,genesis:genesis.txid};
 async function apply(action:number){const terms={stake:maximum?1000000n:3000n,duration:maximum?33553920:513,reward:maximum?16000000n:rewardAsset.kind==='bch'?1000n:7n,maxWins:maximum?16:2};const sponsorTx=add(baseTx([{valueSatoshis:sponsorAmount(instance,action),lockingBytecode:hexToBin(script)}])),stake=action===0?add(baseTx([toOutput(stakingAsset,terms.stake*BigInt(terms.maxWins),stakingAsset.kind==='bch'?0n:1000n)])):undefined;
 const built=transitionBuilder(instance,action,action===0?instance.state[5]!:0,provider,{height:100,mtp:1800000000},{input:utxo(sponsorTx,0),unlocker:key.unlockP2PKH()},key,stake?{owner:key.publicKey,terms,funding:{input:utxo(stake,0),unlocker:key.unlockP2PKH()}}:undefined),tx=add(built.builder.build());if(action===3&&instance.state[5]===16){const vm=built.builder.getVmResourceUsage();await writeFile('docs/generalized-assets-v3-max-resources.json',JSON.stringify({roster:16,registryBytes:covenant('RegistryV3',[Buffer.from(instance.category,'hex').reverse(),...parameterArgs(p)],provider).bytesize,genesisBytes:factory.bytesize,transactionBytes:tx.hex.length/2,vm},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');}instance={...instance,state:built.state,inputs:[utxo(tx,0),utxo(tx,1),utxo(tx,2)]};return tx;}
 await apply(0);if(stakingAsset.kind==='bch'&&rewardAsset.kind==='bch')for(let i=1;i<16;i++)await apply(0);const settled=await apply(3);
 let failed=false,disagree=false,endpoint='';
 const fake={network:Network.REGTEST,endpoints:['wss://one.test','wss://two.test'],get endpoint(){return endpoint;},async session<T>(work:()=>Promise<T>,peer:string){endpoint=peer;return work();},async tip(){if(failed)throw Error('Provider offline');return {height:100,hash:disagree&&endpoint.includes('two')?'ee'.repeat(32):'dd'.repeat(32),hex:'',parent:'',time:1800000000,merkle:''};},async medianTime(height:number){return height===1?1700000000:1800000000;},async header(height:number){return {height,hash:'dd'.repeat(32)};},async transaction(id:string,height?:number){const tx=txs.get(id);if(!tx)throw Error('Unknown fixture transaction');return {...tx,confirmations:height&&height>0?1:0};},async history(locking:string){const entries=[];for(const tx of txs.values()){if(tx.vout.some((o:any)=>o.scriptPubKey.hex===locking)||tx.vin.some((i:any)=>txs.get(i.txid)?.vout[i.vout]?.scriptPubKey.hex===locking))entries.push({tx_hash:tx.txid,height:heights.get(tx.txid)!});}return entries;},async transactionStatus(id:string){const height=heights.get(id);if(height===undefined)throw Error('Unknown fixture transaction');return {...txs.get(id),height,confirmations:height>0?100:0};},async getUtxosForLockingBytecode(script:string){const coins=[];for(const tx of txs.values())for(const o of tx.vout)if(o.scriptPubKey.hex===script&&![...txs.values()].some(t=>t.vin.some((i:any)=>i.txid===tx.txid&&i.vout===o.n)))coins.push(utxo(tx,o.n));return coins;},async verifyHeaderChain(){}} as unknown as ElectrumCore;
 const index=new AssetIndexer(fake,config),full=await index.sync();assert.equal(full.instance.inputs[0].txid,settled.txid);assert.equal(full.allocations.length,1);assert.equal(full.allocations[0]!.mature,true);
 heights.set(settled.txid,0);const pending=await index.sync();assert.deepEqual(pending.instance.state,full.instance.state);assert.equal(pending.allocations.length,1);assert.equal(pending.allocations[0]!.mature,false);assert.deepEqual(pending.pendingHistory,[settled.txid]);assert.ok(!pending.history.includes(settled.txid));
 heights.set(settled.txid,2);assert.equal((await index.sync()).allocations.length,1);
 txs.delete(settled.txid);const reorg=await index.sync();assert.equal(reorg.allocations.length,0);assert.equal(reorg.instance.state[4],0);
 failed=true;await assert.rejects(()=>index.sync(),e=>e instanceof ProviderVerificationError&&e.category==='unavailable');assert.equal(index.snapshot,reorg);assert.ok(index.error);failed=false;
 disagree=true;await assert.rejects(()=>index.sync(),e=>e instanceof ProviderVerificationError&&e.category==='conflict');assert.equal(index.snapshot,reorg);disagree=false;
 // A second confirmed spend of the canonical activation must never be selected arbitrarily.
 txs.set(settled.txid,settled);const conflicting=structuredClone(settled);conflicting.txid='ff'.repeat(32);txs.set(conflicting.txid,conflicting);heights.set(conflicting.txid,2);await assert.rejects(()=>index.sync(),e=>e instanceof ProviderVerificationError&&e.category==='conflict');assert.equal(index.snapshot,reorg);
 }
});

test('factory-independent direct genesis validation pins roles, reserve, state, category and token conservation',()=>{
 const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
 const key=new SignatureTemplate(new Uint8Array(32).fill(72)),owner={publicKey:binToHex(key.publicKey),path:'receive' as const,index:0},script=walletScript(owner.publicKey),p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'token',category:'bb'.repeat(32)},cap:2000n,periods:4,epoch:1700000000,periodSeconds:10};
 const inputs:SpendableUtxo[]=[{txid:'aa'.repeat(32),vout:0,satoshis:1000000n,lockingBytecode:script},{txid:'cc'.repeat(32),vout:1,satoshis:1000n,lockingBytecode:script,token:{category:'bb'.repeat(32),amount:10000n}}];
 const built=directGenesisBuilder(p,inputs.map(utxo=>({...owner,utxo})),owner,provider),tx=built.builder.generateWcTransactionObject({broadcast:false}).transaction as Transaction;
 const raw=(t:Transaction)=>binToHex(encodeTransaction(t));assert.equal(validateGenesis(p,raw(tx),inputs,provider).category,inputs[0]!.txid);
 // Structural validation is independent of wallet signatures; indexer replay
 // subsequently runs validateBuilt for VM execution and the fixed fee.
 for(const mutate of [
  (t:Transaction)=>{t.outputs[0]!.token!.nft!.commitment=new Uint8Array(32);},
  (t:Transaction)=>{t.outputs[0]!.token!.category=hexToBin('dd'.repeat(32));},
  (t:Transaction)=>{t.outputs[1]!.lockingBytecode=hexToBin('51');},
  (t:Transaction)=>{t.outputs[2]!.token!.amount--;t.outputs[3]!.token!.amount++;},
  (t:Transaction)=>{t.outputs[3]!.token!.amount--;},
  (t:Transaction)=>{t.outputs[3]!.token!.nft={capability:'none',commitment:new Uint8Array()};},
  (t:Transaction)=>{t.outputs.push(structuredClone(t.outputs[0]!));},
  (t:Transaction)=>{t.outputs[4]!.lockingBytecode=hexToBin('51');},
  (t:Transaction)=>{t.inputs[0]!.outpointIndex=1;},
 ]){const bad=structuredClone(tx);mutate(bad);assert.throws(()=>validateGenesis(p,raw(bad),inputs,provider));}
 const nft=structuredClone(inputs);nft[1]!.token!.nft={capability:'none',commitment:'12'};assert.throws(()=>validateGenesis(p,raw(tx),nft,provider),/NFT/);
});
