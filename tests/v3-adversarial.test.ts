import test from 'node:test';
import assert from 'node:assert/strict';
import {MockNetworkProvider,Network,SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,encodeTransaction,hexToBin,type Transaction} from '@bitauth/libauth';
import {Buffer} from '../src/bytes.js';
import {decodeRawTransaction} from '../src/electrum-core.js';
import {utxo,records} from '../src/arena-core.js';
import {offer,remainingCommitment} from '../src/registry.js';
import {walletScript} from '../src/transactions-core.js';
import {covenant,family,parameterArgs,genesisBuilder,transitionBuilder,validateBuilt,sponsorAmount,assetOutput,stateOutput,ownerAddress,termsFor,rewardRemaining,type Parameters,type Instance} from '../src/v3/protocol.js';
test('v3 covenant rejects malicious winners, release inflation, accounting theft and stale state independently of builders',()=>{
 const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
 const key=new SignatureTemplate(new Uint8Array(32).fill(83)),other=new SignatureTemplate(new Uint8Array(32).fill(84)),script=walletScript(Buffer.from(key.publicKey).toString('hex'));
 const p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},cap:2000n,periods:4,epoch:1800000000,periodSeconds:3600};let counter=0;
 const clock={height:100,mtp:p.epoch+7201};
 function coin(amount:bigint,locking=script){const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:amount,lockingBytecode:hexToBin(locking)}]}));return utxo(decodeRawTransaction(raw),0);}
 const factory=covenant('RegistryGenesisV3',parameterArgs(p),provider),f=coin(12000n,factory.lockingBytecode),g=genesisBuilder(p,f,{input:coin(9000n),unlocker:key.unlockP2PKH()},provider),genesis=decodeRawTransaction(g.builder.build());
 let v:Instance={parameters:p,category:f.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};
 function register(stake:bigint,reward:bigint,maxWins=2){const terms={stake,reward,duration:512,maxWins},built=transitionBuilder(v,0,v.state[5]!,provider,clock,{input:coin(sponsorAmount(v,0)),unlocker:key.unlockP2PKH()},key,{owner:key.publicKey,terms,funding:{input:coin(stake*BigInt(maxWins)),unlocker:key.unlockP2PKH()}}),tx=decodeRawTransaction(built.builder.build());v={...v,state:built.state,inputs:[utxo(tx,0),utxo(tx,1),utxo(tx,2)]};}
 register(3000n,2000n);register(6000n,4000n); // exact priority tie: slot zero wins
 /** Construct an internally consistent claim for any slot without invoking the safe builder. */
 function malicious(slot:number,time=clock.mtp-1,mutate?:(b:TransactionBuilder)=>void){const cs=family(p,v.category,provider),s=Buffer.from(v.state),winner=records(s)[slot]!,remaining=rewardRemaining(s);s[6+slot*49+46]!++;s.writeUInt32LE(Number(remaining-BigInt(winner.reward)),790);const terms=termsFor(v,slot),a=covenant('StakeAllocationV3',[terms],provider),sponsor=coin(sponsorAmount(v,3));
 const b=new TransactionBuilder({provider}).setLocktime(time).addInput(v.inputs[0],cs.registry.unlock.transition(v.state,3n,BigInt(slot),Buffer.alloc(0),Buffer.alloc(0))).addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend()).addInput(sponsor,key.unlockP2PKH()).addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,s)}).addOutput({to:cs.escrow.address,...assetOutput(p.stakingAsset,remainingCommitment(s))}).addOutput({to:cs.reserve.address,...assetOutput(p.rewardAsset,rewardRemaining(s))}).addOutput({to:ownerAddress(key.publicKey,provider),...assetOutput(p.rewardAsset,BigInt(winner.reward),0n)}).addOutput({to:a.address,...assetOutput(p.stakingAsset,BigInt(winner.stake),0n)});
 mutate?.(b);return {raw:binToHex(encodeTransaction((b as any).buildLibauthTransaction(true))),sources:[...v.inputs,sponsor]};}
 let good=malicious(0);validateBuilt(good.raw,good.sources,clock);
 const tie=malicious(1);assert.throws(()=>validateBuilt(tie.raw,tie.sources,clock),/covenant/);
 const finalSequence=malicious(0,clock.mtp-1,b=>{(b as any).inputs[0].options={sequence:0xffffffff};});assert.throws(()=>validateBuilt(finalSequence.raw,finalSequence.sources,clock),/covenant/);
 const before=malicious(0,p.epoch-1);assert.throws(()=>validateBuilt(before.raw,before.sources,clock),/covenant/);
 const future=malicious(0,p.epoch+10800);assert.throws(()=>validateBuilt(future.raw,future.sources,clock),/not final/);
 const insufficient=malicious(0,p.epoch);assert.throws(()=>validateBuilt(insufficient.raw,insufficient.sources,{...clock,mtp:p.epoch}),/not final/);
 // Signatures are regenerated for each malicious output set: rejection is covenant enforcement.
 const theft=malicious(0,clock.mtp-1,b=>{(b as any).outputs[3].to=ownerAddress(other.publicKey,provider);});
 assert.throws(()=>validateBuilt(theft.raw,theft.sources,clock),/covenant/);
 const stateCorruption=malicious(0,clock.mtp-1,b=>{(b as any).outputs[0].token.nft.commitment='00'.repeat(32);});assert.throws(()=>validateBuilt(stateCorruption.raw,stateCorruption.sources,clock),/covenant/);
 // Bypass registration validation and sign a fully funded R > reserve offer.
 {const cs=family(p,v.category,provider),slot=v.state[5]!,record=offer(key.publicKey,1000,512,9000,1),s=Buffer.from(v.state);s[5]=slot+1;s.set(record,6+slot*49);const stake=coin(1000n),fee=coin(10000n);
 const b=new TransactionBuilder({provider}).setLocktime(clock.mtp-1).addInput(v.inputs[0],cs.registry.unlock.transition(v.state,0n,BigInt(slot),record,key)).addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend()).addInput(stake,key.unlockP2PKH()).addInput(fee,key.unlockP2PKH()).addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,s)}).addOutput({to:cs.escrow.address,...assetOutput(p.stakingAsset,remainingCommitment(s))}).addOutput({to:cs.reserve.address,...assetOutput(p.rewardAsset,rewardRemaining(s))});
 const raw=binToHex(encodeTransaction((b as any).buildLibauthTransaction(true)));assert.throws(()=>validateBuilt(raw,[...v.inputs,stake,fee],clock),/covenant/);}
 // Higher priority R is larger than the released buffer. A cheaper lower offer cannot bypass it.
 register(30000n,8000n,1);const blocked=malicious(2);assert.throws(()=>validateBuilt(blocked.raw,blocked.sources,clock),/covenant/);good=malicious(0);assert.throws(()=>validateBuilt(good.raw,good.sources,clock),/covenant/);
 for(const network of [Network.TESTNET3,Network.TESTNET4])assert.throws(()=>covenant('RegistryV3',[],Object.assign(new MockNetworkProvider(),{network})),/Unsupported V3 network/);
 const chipnet=Object.assign(new MockNetworkProvider(),{network:Network.CHIPNET});assert.equal(family(p,v.category,chipnet).registry.lockingBytecode,family(p,v.category,provider).registry.lockingBytecode);
});

test('v3 Electrum transport pins local endpoints and regtest genesis before enabling broadcast',async()=>{
 const {ElectrumCore,decodeRawTransaction}=await import('../src/electrum-core.js');
 const {rpc,assertRegtest}=await import('../src/rpc.js');await assertRegtest();
 const genesis=await rpc<string>('getblockheader',[await rpc('getblockhash',[0]),false]);
 let wrongChain=false,broadcasts=0;
 const factory=()=>({connect:async()=>{},close:()=>{},request:async(method:string,...params:any[])=>{if(method==='server.version')return ['local-fixture','1.5.0'];if(method==='blockchain.block.header')return wrongChain?'00'.repeat(80):genesis;if(method==='blockchain.transaction.broadcast'){broadcasts++;return decodeRawTransaction(params[0]).txid;}throw Error('Unexpected test request');}});
 assert.throws(()=>new ElectrumCore(factory,{network:'regtest',endpoints:['wss://public.example']}),/local endpoints/);
 assert.equal(new ElectrumCore(factory,{network:'mainnet'}).network,Network.MAINNET);
 const p=new ElectrumCore(factory,{network:'regtest',endpoints:['wss://127.0.0.1:4177'],allowBroadcast:true});assert.equal(p.network,Network.REGTEST);
 const raw=binToHex(encodeTransaction({version:2,locktime:0,inputs:[],outputs:[]}));
 await assert.rejects(()=>p.sendRawTransaction(raw),/verified active/);
 await p.session(async()=>{assert.equal((await p.header(0)).hash,'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206');await p.sendRawTransaction(raw);});assert.equal(broadcasts,1);
 wrongChain=true;await assert.rejects(()=>p.session(()=>p.sendRawTransaction(raw)),/regtest identity/);assert.equal(broadcasts,1);
 await assert.rejects(()=>p.sendRawTransaction(raw),/verified active/);
});
