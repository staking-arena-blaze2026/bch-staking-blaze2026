import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Contract,MockNetworkProvider,Network,SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,decodeTransaction,type Transaction} from '@bitauth/libauth';
import {Buffer} from '../src/bytes.js';
import {utxo,rankings} from '../src/arena-core.js';
import {decodeRawTransaction} from '../src/electrum-core.js';
import {walletScript} from '../src/transactions-core.js';
import {announcement,parseAnnouncement,announcementScript} from '../src/v3/discovery.js';
import {covenant,parameterArgs,family,stateOutput,genesisBuilder,chainedPreparation,chainedChildBuilder,directGenesisBuilder,validateGenesis,validateBuilt,validateInstance,initialState,rewardRemaining,buffer,decision,advance,transitionBuilder,sponsorAmount,withdrawalBuilder,validateParameters,type Parameters,type Instance} from '../src/v3/protocol.js';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {TokenRegtestProvider} from '../src/token-provider.js';
import {rpc} from '../src/rpc.js';
const counts=[1,16,17,100,365,1000];
const native={kind:'bch' as const};
const base:Parameters={version:3,stakingAsset:native,rewardAsset:native,epoch:1800000000,periodSeconds:86400,periods:1000,cap:1000000n};
const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
const key=new SignatureTemplate(new Uint8Array(32).fill(93)),owner={publicKey:binToHex(key.publicKey),path:'receive' as const,index:0},script=walletScript(owner.publicKey);
let counter=0;
function coin(amount:bigint,locking=script,token?:{category:Uint8Array;amount:bigint}){return utxo(decodeRawTransaction(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:amount,lockingBytecode:hexToBin(locking),...(token?{token}:{})}]}))),0);}
function unlock(input:ReturnType<typeof coin>){return {input,unlocker:key.unlockP2PKH()};}
for(const registryVersion of [undefined,4] as const)for(const periods of counts)test(`release count ${periods}, registry ${registryVersion??3}: canonical genesis, accumulation, reserve and discovery`,()=>{
 const p:Parameters={...base,registryVersion,periods},reserve=p.cap*BigInt(periods);
 assert.equal(rewardRemaining(initialState(p)),reserve);
 assert.equal(buffer(p,initialState(p),p.epoch+periods*p.periodSeconds-1),reserve-p.cap);
 assert.equal(buffer(p,initialState(p),p.epoch+periods*p.periodSeconds),reserve);
 assert.equal(buffer(p,initialState(p),2147483647),reserve);
 const factory=covenant(registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(p),provider),f=coin(12000n,factory.lockingBytecode),funding=coin(reserve+1000n),g=genesisBuilder(p,f,unlock(funding),provider),raw=g.builder.build();
 validateBuilt(raw,[f,funding],{height:100,mtp:2000000000});validateGenesis(p,raw,[f,funding],provider);
 // Both legacy and linked genesis reconstruct exactly the SDK's minimal Script integers.
 const prep=chainedPreparation(p,key.publicKey,provider),parent=decodeRawTransaction(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin('ab'.repeat(32)),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:12000n,lockingBytecode:hexToBin(prep.genesis.lockingBytecode)},{valueSatoshis:reserve+1000n,lockingBytecode:hexToBin(prep.funding.lockingBytecode)}]}))),inputs=[utxo(parent,0),utxo(parent,1)];
 const child=chainedChildBuilder(p,inputs[0]!,inputs[1]!,key.publicKey,provider);validateBuilt(child.builder.build(),inputs,{height:100,mtp:2000000000});
 const source=coin(reserve+100000n),direct=directGenesisBuilder(p,[{...owner,utxo:source}],owner,provider),tx=direct.builder.generateWcTransactionObject({broadcast:false}).transaction as Transaction;
 validateGenesis(p,binToHex(encodeTransaction(tx)),[source],provider);
 tx.outputs[2]!.valueSatoshis--;assert.throws(()=>validateGenesis(p,binToHex(encodeTransaction(tx)),[source],provider));
 const announced={...p,discovery:1 as const};delete announced.registryVersion;if(registryVersion)announced.registryVersion=registryVersion;
 for(const mode of ['direct','parent'] as const){const payload=announcement(announced,mode);assert.deepEqual(parseAnnouncement(payload.toString('hex')),{parameters:announced,mode});assert.equal(announcementScript(announced,mode),'6a4c'+payload.length.toString(16)+payload.toString('hex'));}
 const expected=new Contract(JSON.parse(readFileSync(`artifacts/${periods>16?'releases1000/':''}${registryVersion===4?'RegistryAtomicV4':'RegistryV3'}.json`,'utf8')),[Buffer.from(f.txid,'hex').reverse(),...parameterArgs(p)],{provider,contractType:'p2sh32'});
 assert.equal(family(p,f.txid,provider).registry.lockingBytecode,expected.lockingBytecode);
});
test('release bounds, timestamp edge and reserve arithmetic remain exact',()=>{
 for(const periods of [0,-1,1001,1.5,NaN,Infinity])assert.throws(()=>validateParameters({...base,periods}),/whole number from 1 to 1000/);
 assert.equal(validateParameters({...base,periodSeconds:1,epoch:2147482647}).epoch+1000,2147483647);
 assert.throws(()=>validateParameters({...base,periodSeconds:1,epoch:2147482648}),/boundary/);
 for(const cap of [0n,1000001n])assert.throws(()=>validateParameters({...base,cap}));
 assert.equal(rewardRemaining(initialState(base)),1000000000n);
 for(const periodSeconds of [0,-1,1.1,2147483648])assert.throws(()=>validateParameters({...base,periodSeconds}));
});
test('original compiled artifacts are preserved byte for byte',()=>{
 const expected=JSON.parse(readFileSync('tests/fixtures/legacy-v3-artifact-hashes.json','utf8'));
 for(const [name,hash]of Object.entries(expected))assert.equal(createHash('sha256').update(readFileSync(`artifacts/${name}.json`)).digest('hex'),hash);
});

for(const registryVersion of [undefined,4] as const)test(`registry ${registryVersion??3}: token reserve arithmetic and genesis at every release count`,()=>{
 for(const periods of counts)for(const cap of [1n,16n,17n,1000000n]){
  const p:Parameters={...base,registryVersion,periods,cap,stakingAsset:{kind:'token',category:'cc'.repeat(32)},rewardAsset:{kind:'token',category:'dd'.repeat(32)}},reserve=cap*BigInt(periods);
  const factory=covenant(registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(p),provider),f=coin(12000n,factory.lockingBytecode),funding=coin(1000n,script,{category:hexToBin('dd'.repeat(32)),amount:reserve}),g=genesisBuilder(p,f,unlock(funding),provider);
  const raw=g.builder.build();validateBuilt(raw,[f,funding],{height:100,mtp:2000000000});validateGenesis(p,raw,[f,funding],provider);assert.equal(rewardRemaining(g.state),reserve);
 }
});
test('raw genesis covenants independently reject release counts above 1000 and legacy counts above 16',()=>{
 for(const name of ['RegistryGenesisV3','RegistryAtomicGenesisV4'])for(const periods of [17,1001]){
  const args=parameterArgs({...base,periods:16});args[3]=BigInt(periods);
  const directory=periods===1001?'releases1000/':'',artifact=JSON.parse(readFileSync(`artifacts/${directory}${name}.json`,'utf8')),factory=new Contract(artifact,args,{provider,contractType:'p2sh32'}),f=coin(12000n,factory.lockingBytecode),reserve=base.cap*BigInt(periods),funding=coin(reserve+1000n);
  const registryName=name==='RegistryGenesisV3'?'RegistryV3':'RegistryAtomicV4',registry=new Contract(JSON.parse(readFileSync(`artifacts/${directory}${registryName}.json`,'utf8')),[Buffer.from(f.txid,'hex').reverse(),...args],{provider,contractType:'p2sh32'}),roles=family({...base,periods:16},f.txid,provider),state=initialState({...base,periods:16});state.writeUInt32LE(Number(reserve),790);
  const builder=new TransactionBuilder({provider}).addInput(f,factory.unlock.create()).addInput(funding,key.unlockP2PKH()).addOutput({to:registry.tokenAddress,...stateOutput(f.txid,state)}).addOutput({to:roles.escrow.address,amount:1000n}).addOutput({to:roles.reserve.address,amount:reserve+1000n});
  assert.throws(()=>validateBuilt(builder.build(),[f,funding],{height:100,mtp:2000000000}));
 }
});

test('maximum reserve and ranking arithmetic with sixteen maximal offers',()=>{
 for(const registryVersion of [undefined,4] as const){
  const p={...base,registryVersion},reserve=1000000000n,factory=covenant(registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(p),provider),f=coin(12000n,factory.lockingBytecode),funding=coin(reserve+1000n),g=genesisBuilder(p,f,unlock(funding),provider),genesis=decodeRawTransaction(g.builder.build());
  let v:Instance={parameters:p,category:f.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};
  const clock={height:100,mtp:p.epoch+p.periods*p.periodSeconds+1},terms={stake:1000000n,duration:33553920,reward:reserve,maxWins:1};
  for(let slot=0;slot<16;slot++){
   const fee=coin(sponsorAmount(v,0)),stake=coin(1000000n),built=transitionBuilder(v,0,slot,provider,clock,unlock(fee),key,{owner:key.publicKey,terms,funding:unlock(stake)}),raw=built.builder.build();validateBuilt(raw,built.sources,clock);const tx=decodeRawTransaction(raw);v={...v,state:built.state,inputs:[utxo(tx,0),utxo(tx,1),utxo(tx,2)]};
  }
  const built=transitionBuilder(v,3,0,provider,clock,unlock(coin(sponsorAmount(v,3))));validateBuilt(built.builder.build(),built.sources,clock);assert.equal(rewardRemaining(built.state),0n);assert.equal(rankings(built.state,false)[0]!.slot,1);
 }
});

test('isolated BCHN: all release counts, V3/V4 creation, MTP claims, legacy actions and lifetime capacity',{timeout:900000},async()=>isolatedRegtest(async()=>{
 const node=new TokenRegtestProvider(),deposit=new Contract(JSON.parse(readFileSync('artifacts/RegistryDeposit.json','utf8')),[key.publicKey],{provider:node,contractType:'p2sh32'}),miner=await rpc<string>('getnewaddress');
 const clock=async()=>{const c=await rpc('getblockchaininfo');return {height:c.blocks,mtp:c.mediantime};};
 const mine=()=>rpc('generatetoaddress',[1,miner]);
 async function warp(t:number){await rpc('setmocktime',[t]);await rpc('generatetoaddress',[11,miner]);}
 async function out(id:string,n=0){return utxo(await rpc('getrawtransaction',[id,true]),n);}
 async function fund(amount:bigint,to=deposit){const id=await rpc<string>('sendtoaddress',[to.address,Number(amount)/1e8]),tx=await rpc('getrawtransaction',[id,true]);return utxo(tx,tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===to.lockingBytecode&&Math.round(o.value*1e8)===Number(amount)));}
 const sponsor=(input:Awaited<ReturnType<typeof fund>>)=>({input,unlocker:deposit.unlock.spend(key)});
 async function send(raw:string){const [a]=await rpc('testmempoolaccept',[[raw]]);assert.equal(a.allowed,true,JSON.stringify(a));const id=await node.sendRawTransaction(raw);await mine();return id;}
 for(const registryVersion of [undefined,4] as const)for(const periods of counts){
  const p:Parameters={...base,registryVersion,periods,cap:1000n,epoch:(await clock()).mtp+100,periodSeconds:10};
  const factory=covenant(registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(p),node),parent=new TransactionBuilder({provider:node}).addInput(await fund(22000n),deposit.unlock.spend(key)).addOutput({to:factory.address,amount:12000n}),pid=await send(parent.build()),f=await out(pid),funding=await fund(p.cap*BigInt(periods)+1000n),g=genesisBuilder(p,f,sponsor(funding),node),gid=await send(g.builder.build());
  let v:Instance={parameters:p,category:pid,state:g.state,inputs:[await out(gid),await out(gid,1),await out(gid,2)]};validateInstance(v,node);validateGenesis(p,g.builder.build(),[f,funding],node);
  const terms={stake:3000n,duration:1,reward:1000n,maxWins:1};
  async function build(action:number,slot=0){return transitionBuilder(v,action,slot,node,await clock(),sponsor(await fund(sponsorAmount(v,action))),key,action===0?{owner:key.publicKey,terms,funding:sponsor(await fund(3000n))}:undefined);}
  async function apply(action:number,slot=0){const b=await build(action,slot),id=await send(b.builder.build());v={...v,state:b.state,inputs:[await out(id),await out(id,1),await out(id,2)]};validateInstance(v,node);return {b,id};}
  await apply(0);assert.equal(buffer(p,v.state,(await clock()).mtp-1),0n);await assert.rejects(()=>build(3),/buffer/);
  // MTP must strictly exceed the release boundary; wall-clock time never releases funds.
  await warp(p.epoch+10);assert.equal(decision({parameters:p,state:v.state},{mtp:p.epoch+10}).phase,'blocked');await assert.rejects(()=>build(3),/buffer/);
  await warp(p.epoch+periods*10+1);const paid=await apply(3);assert.equal(rewardRemaining(v.state),1000n*BigInt(periods-1));assert.equal(buffer(p,v.state,(await clock()).mtp-1),1000n*BigInt(periods-1));assert.equal(rankings(v.state,false).length,0);
  if(periods>1){await apply(0,1);await apply(1,1);await apply(4,1);}
  if(periods===1000){for(let slot=v.state[5]!;slot<16;slot++)await apply(0,slot);await assert.rejects(()=>build(0,16),/capacity|slot|Registration/i);assert.throws(()=>advance(v.state,0,16));}
  await warp((await clock()).mtp+600);const withdrawal=withdrawalBuilder(await out(paid.id,4),paid.b.terms!,key,sponsor(await fund(10000n)),node);await send(withdrawal.build());
  console.log(`PASS native registry ${registryVersion??3}, ${periods} releases: genesis, claim, cancellation/refund, withdrawal${periods===1000?', 16 lifetime slots':''}`);
 }
},18568));
