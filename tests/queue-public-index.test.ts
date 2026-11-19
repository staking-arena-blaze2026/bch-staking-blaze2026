import assert from 'node:assert/strict';
import test from 'node:test';
import {binToHex,encodeDataPush,hexToBin} from '@bitauth/libauth';
import {SignatureTemplate,type SpendableUtxo} from 'cashscript';
import {decodeRawTransaction,type HistoryEntry} from '../src/electrum-core.js';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {addAnnouncement,payload} from '../src/queue/discovery.js';
import {emptyQueueIndex,refreshQueueCounts,scanQueueIndex,type QueueIndexState} from '../src/queue/public-index.js';
import {create,insert,ownerScript,ZERO} from '../src/queue/protocol.js';
import {utxo} from '../src/arena-core.js';
import {DISCOVERY_CARRIER,discoveryScript} from '../src/v3/discovery.js';

for(const network of ['mainnet','chipnet'] as const)test(`${network} queue discovery survives delayed confirmation, outages and discarded runs`,async()=>{
 const provider=new BrowserElectrumProvider({network,allowBroadcast:false});
 const [,second]=provider.endpoints;
 const key=new SignatureTemplate(new Uint8Array(32).fill(71)),creator=binToHex(key.publicKey);
 const lockingBytecode=binToHex(ownerScript(key.publicKey));
 const origin=(byte:string):SpendableUtxo=>({txid:byte.repeat(32),vout:0,lockingBytecode,satoshis:50000n});
 const vault=origin('12'),queue=origin('34');
 const parameters={stakingCategory:ZERO,rewardCategory:ZERO,cap:2000n,epoch:1795000000,interval:600,releases:6};
 const a={parameters,creator,queue:queue.txid};
 const fund=(input:SpendableUtxo)=>({input,unlocker:key.unlockP2PKH()});
 const build=(malformed=false)=>create(parameters,fund(vault),fund(queue),[],key,provider,1n,{
  cost:DISCOVERY_CARRIER,add:b=>{
   if(!malformed)addAnnouncement(b,provider,a);
   else b.addOutput({to:hexToBin(discoveryScript(network)),amount:DISCOVERY_CARRIER})
    .addOutput({to:Uint8Array.of(0x6a,...encodeDataPush(payload(a).subarray(0,-1))),amount:0n});
  },
 });
 const genesis=decodeRawTransaction(build().raw),malformed=decodeRawTransaction(build(true).raw);
 const txid=genesis.txid;
 let height=0,visible=false,outage=false,failSources=false;
 for(const endpoint of provider.endpoints){
  const peer=provider.independentReader(endpoint)!;
  peer.session=async work=>{if(outage)throw Error('Provider unavailable');return work();};
  peer.history=async script=>{
   assert.equal(script,discoveryScript(network));
   return endpoint===second&&visible?[{tx_hash:txid,height},{tx_hash:malformed.txid,height:1}]:[];
  };
  peer.transaction=async id=>{
   if(id===txid)return genesis;
   if(id===malformed.txid)return malformed;
   if(failSources)throw Error('Source temporarily unavailable');
   assert.ok(id===vault.txid||id===queue.txid);
   return {txid:id,vout:[{satoshis:'50000',scriptPubKey:{hex:lockingBytecode}}]};
  };
  peer.transactionStatus=async (id:string,row?:HistoryEntry)=>{
   assert.deepEqual(row,{tx_hash:id,height});
   return {...genesis,confirmations:height>0?1:0};
  };
 }
 const checkpoint=(state:QueueIndexState)=>structuredClone(state);
 let state=emptyQueueIndex(network);
 await scanQueueIndex(state,provider,5000);
 assert.deepEqual(state.vaults,{});
 visible=true;
 const unconfirmed=await scanQueueIndex(state,provider,5000);
 assert.equal(unconfirmed.pending[txid],'Awaiting on-chain confirmation');
 assert.ok(state.pending[txid]);
 assert.equal(state.pending[malformed.txid],undefined);
 assert.ok(state.seen.includes(malformed.txid));
 height=42;
 failSources=true;
 const failed=await scanQueueIndex(state,provider,5000);
 assert.match(failed.pending[txid]!,/Source temporarily unavailable/);
 assert.ok(state.pending[txid]);
 const retained=checkpoint(state);
 failSources=false;
 await scanQueueIndex(state,provider,5000);
 assert.ok(state.vaults[txid]);
 // An interrupted run can leave the previous durable checkpoint in place.
 state=retained;
 await scanQueueIndex(state,provider,5000);
 assert.deepEqual(state.vaults[txid],{parameters,identity:{vault:vault.txid,queue:queue.txid},anchor:{genesis:txid,creator}});
 assert.equal(state.pending[txid],undefined);
 const countReader=provider.independentReader(provider.endpoints[0]!)!;
 countReader.tip=async()=>({height:42,hash:'aa'.repeat(32),hex:'',parent:'',merkle:'',time:parameters.epoch});
 const current=Array.from({length:2},(_,n)=>utxo(genesis,n));
 countReader.reportedUtxosForLockingBytecode=async script=>current.filter(coin=>coin.lockingBytecode===script);
 assert.equal(await refreshQueueCounts(state,[countReader],5000),1);
 assert.deepEqual({...state.counts?.[txid],updatedAt:null},{network,vaultId:txid,waiting:0,updatedAt:null});
 const terms={stake:3000n,reward:2000n,duration:512};
 const registered=decodeRawTransaction(insert(build().context,current[0]!,current[1]!,terms,key,[fund(origin('56'))]).raw);
 current.splice(0,2,...Array.from({length:3},(_,n)=>utxo(registered,n)));
 assert.equal(await refreshQueueCounts(state,[countReader],5000),1);
 assert.equal(state.counts?.[txid]?.waiting,1);
 const last=structuredClone(state.counts?.[txid]);
 outage=true;
 const offline=await scanQueueIndex(state,provider,5000);
 assert.equal(offline.online,0);
 assert.ok(state.vaults[txid]);
 assert.equal(await refreshQueueCounts(state,[countReader],5000),0);
 assert.deepEqual(state.counts?.[txid],last);
});
