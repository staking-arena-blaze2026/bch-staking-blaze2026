import assert from 'node:assert/strict';
import test from 'node:test';
import {binToHex,decodeTransaction,encodeDataPush,encodeTransaction,hexToBin} from '@bitauth/libauth';
import {SignatureTemplate,type SpendableUtxo} from 'cashscript';
import {decodeRawTransaction,type HistoryEntry} from '../src/electrum-core.js';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {readQueueCatalog} from '../src/queue/catalog.js';
import {addAnnouncement,payload} from '../src/queue/discovery.js';
import {emptyQueueIndex,refreshQueueCatalog,scanQueueIndex,scanQueueMempool,type QueueCandidate,type QueueIndexState} from '../src/queue/public-index.js';
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
 const build=(malformed=false,p=parameters)=>create(p,fund(vault),fund(queue),[],key,provider,1n,{
  cost:DISCOVERY_CARRIER,add:b=>{
   if(!malformed)addAnnouncement(b,provider,{...a,parameters:p});
   else b.addOutput({to:hexToBin(discoveryScript(network)),amount:DISCOVERY_CARRIER})
    .addOutput({to:Uint8Array.of(0x6a,...encodeDataPush(payload(a).subarray(0,-1))),amount:0n});
  },
 });
 const genesis=decodeRawTransaction(build().raw),malformed=decodeRawTransaction(build(true).raw);
 const conflict=decodeRawTransaction(build(false,{...parameters,releases:7}).raw);
 const invalidTx=decodeTransaction(hexToBin(genesis.hex));
 assert.notEqual(typeof invalidTx,'string');
 if(typeof invalidTx==='string')throw Error(invalidTx);
 invalidTx.inputs[0]!.unlockingBytecode=new Uint8Array();
 const invalid=decodeRawTransaction(binToHex(encodeTransaction(invalidTx)));
 const txid=genesis.txid;
 let height=0,visible=false,outage=false,failSources=false,competing=false,preparation=false;
 for(const endpoint of provider.endpoints){
  const peer=provider.independentReader(endpoint)!;
  peer.session=async work=>{if(outage)throw Error('Provider unavailable');return work();};
  peer.history=async script=>{
   assert.equal(script,discoveryScript(network));
   if(endpoint!==second)return competing?[{tx_hash:conflict.txid,height:0}]:[];
   if(preparation)return [{tx_hash:vault.txid,height:0}];
   return visible?[{tx_hash:txid,height},{tx_hash:malformed.txid,height:1},{tx_hash:invalid.txid,height:0}]:[];
  };
  peer.mempool=async script=>(await peer.history(script)).filter(row=>row.height<=0);
  peer.transaction=async id=>{
   if(id===txid)return genesis;
   if(id===malformed.txid)return malformed;
   if(id===conflict.txid)return conflict;
   if(id===invalid.txid)return invalid;
   if(failSources)throw Error('Source temporarily unavailable');
   assert.ok(id===vault.txid||id===queue.txid);
   return {txid:id,vin:[],vout:[{satoshis:'50000',scriptPubKey:{hex:lockingBytecode}}]};
  };
  peer.transactionStatus=async (id:string,row?:HistoryEntry)=>{
   assert.ok(height>0);
   assert.deepEqual(row,{tx_hash:id,height});
   return {...genesis,confirmations:height>0?1:0};
  };
 }
 const checkpoint=(state:QueueIndexState)=>structuredClone(state);
 const tracked=new Map<string,QueueCandidate>();
 const live=()=>scanQueueMempool(provider,tracked,new Set(),new Set([txid]));
 let state=emptyQueueIndex(network);
 await scanQueueIndex(state,provider,5000);
 assert.deepEqual(state.vaults,{});
 assert.deepEqual(await live(),[],'signed bytes without a public history entry');
 preparation=true;
 assert.deepEqual(await live(),[],'preparation alone');
 preparation=false;
 visible=true;
 failSources=true;
 assert.deepEqual(await live(),[],'missing parent');
 failSources=false;
 assert.deepEqual((await live()).map(c=>[c.config.anchor.genesis,c.height,c.status]),[[txid,0,'provisional']]);
 height=-1;
 assert.deepEqual((await live()).map(c=>[c.config.anchor.genesis,c.height,c.status]),[[txid,-1,'provisional']]);
 competing=true;
 assert.deepEqual(await live(),[],'different peers see competing spends');
 competing=false;
 visible=false;
 assert.deepEqual(await live(),[],'dropped from all histories');
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
 assert.deepEqual((await live()).map(c=>[c.config.anchor.genesis,c.height,c.status]),[[txid,42,'observed-confirmed']]);
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
 const requests:string[]=[];
 let clocks=0;
 countReader.medianTime=async()=>{clocks++;return parameters.epoch+2*parameters.interval;};
 countReader.reportedUtxosForLockingBytecode=async script=>{requests.push(script);return current.filter(coin=>coin.lockingBytecode===script);};
 const first=state.vaults[txid]!;
 const secondVault={...first,anchor:{...first.anchor,genesis:'e7'.repeat(32)}};
 const observations:string[]=[];
 await readQueueCatalog(countReader,[first,secondVault].map(config=>({config,reward:true,count:false})),value=>{
  if(value.reward)observations.push(value.reward.vaultId);
 });
 assert.deepEqual(observations.sort(),[txid,secondVault.anchor.genesis].sort());
 assert.equal(clocks,1);
 assert.deepEqual(requests,[current[0]!.lockingBytecode,current[0]!.lockingBytecode]);
 requests.length=0;
 assert.deepEqual(await refreshQueueCatalog(state,countReader,5000),{countsUpdated:1,rewardsUpdated:1});
 assert.deepEqual({...state.counts?.[txid],updatedAt:null},{network,vaultId:txid,waiting:0,updatedAt:null});
 assert.equal(requests.length,3);
 assert.deepEqual({...state.rewards?.[txid],updatedAt:null},{
  network,vaultId:txid,remaining:'12000',schedule:{available:'2000',nextRelease:parameters.epoch+2*parameters.interval},updatedAt:null,
 });
 const terms={stake:3000n,reward:2000n,duration:512};
 const registered=decodeRawTransaction(insert(build().context,current[0]!,current[1]!,terms,key,[fund(origin('56'))]).raw);
 current.splice(0,2,...Array.from({length:3},(_,n)=>utxo(registered,n)));
 assert.deepEqual(await refreshQueueCatalog(state,countReader,5000),{countsUpdated:1,rewardsUpdated:1});
 assert.equal(state.counts?.[txid]?.waiting,1);
 const last=structuredClone(state.counts?.[txid]),lastReward=structuredClone(state.rewards?.[txid]);
 outage=true;
 const offline=await scanQueueIndex(state,provider,5000);
 assert.equal(offline.online,0);
 assert.ok(state.vaults[txid]);
 assert.deepEqual(await refreshQueueCatalog(state,countReader,5000),{countsUpdated:0,rewardsUpdated:0});
 assert.deepEqual(state.counts?.[txid],last);
 assert.deepEqual(state.rewards?.[txid],lastReward);
});
