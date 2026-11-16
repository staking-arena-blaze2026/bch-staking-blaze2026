import test from 'node:test';
import assert from 'node:assert/strict';
import {activeConflictPeers,CHIPNET_ENDPOINTS} from '../src/chipnet-policy.js';
import {blockTicks,finalityLimit,matureCoinbase,matureSequence,transactionFinal} from '../src/consensus-clock.js';

test('provider policy retains selected-peer conflicts and leaves mainnet intact',()=>{
 const old=[...CHIPNET_ENDPOINTS,'wss://electrum-chipnet.optnlabs.com'];
 assert.deepEqual(activeConflictPeers('chipnet',old),CHIPNET_ENDPOINTS);
 assert.deepEqual(activeConflictPeers('mainnet',old),old);
});
test('ticks preserve exact pre-upgrade, crossing and post-upgrade boundaries',()=>{
 for(const activationHeight of [108,332450]){
  const context=(height:number)=>({activationHeight,nextBlockTicks:blockTicks(height+1,activationHeight)});
  assert.equal(matureCoinbase(activationHeight+1,context(activationHeight+999)),false);
  assert.equal(matureCoinbase(activationHeight+1,context(activationHeight+1000)),true);
  assert.equal(matureSequence(activationHeight+1,1,context(activationHeight+9)),false);
  assert.equal(matureSequence(activationHeight+1,1,context(activationHeight+10)),true);
  assert.equal(matureSequence(activationHeight+1,0,context(activationHeight)),true);
  const clock={height:activationHeight+10,mtp:1800000000,...context(activationHeight+10)};
  assert.ok(finalityLimit(clock)<clock.height+1);
  assert.equal(transactionFinal({locktime:Math.ceil(finalityLimit(clock)),inputs:[{sequenceNumber:0xfffffffe}]},clock),false);
  assert.equal(transactionFinal({locktime:499999999,inputs:[{sequenceNumber:0xffffffff}]},clock),true);
 }
});

test('chipnet broadcast requires permission, active session, upgraded context and finality',async()=>{
 const {ElectrumCore,decodeRawTransaction}=await import('../src/electrum-core.js');
 const {binToHex,encodeTransaction}=await import('@bitauth/libauth');
 const raw=(locktime=0)=>binToHex(encodeTransaction({version:2,locktime,inputs:[{outpointTransactionHash:new Uint8Array(32).fill(1),outpointIndex:0,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{lockingBytecode:Uint8Array.of(81),valueSatoshis:1000n}]}));
 const p=new ElectrumCore(()=>{throw Error('Unit test has no transport');},{network:'chipnet',allowBroadcast:true});
 let broadcasts=0;const height=200;
 // Synthetic chain context here; native header validity and boundary arithmetic
 // are tested independently by the recorded upgraded-node differential run.
 p.tip=async()=>({height,hash:'tip'} as any);
 p.medianTime=async h=>h<108?1794743999:1794744000;
 p.header=async h=>({height:h,hash:'boundary'} as any);
 p.verifyHeaderChain=async()=>{};
 p.classifyTipChange=async()=>'same';
 p.request=async(method,bytes)=>{assert.equal(method,'blockchain.transaction.broadcast');broadcasts++;return decodeRawTransaction(String(bytes)).txid;};
 await assert.rejects(()=>p.sendRawTransaction(raw()),/verified active/);
 (p as any).activeChainSession=true;
 assert.equal(await p.sendRawTransaction(raw()),decodeRawTransaction(raw()).txid);
 await assert.rejects(()=>p.sendRawTransaction(raw(200)),/Non-final chipnet/);
 p.endpoints.push('wss://electrum-chipnet.optnlabs.com');
 await assert.rejects(()=>p.sendRawTransaction(raw()),/OptnLabs excluded/);
 assert.equal(broadcasts,1);
 const readOnly=new ElectrumCore(()=>{throw Error('No transport');},{network:'chipnet'});
 await assert.rejects(()=>readOnly.sendRawTransaction(raw()),/disabled/);
});
