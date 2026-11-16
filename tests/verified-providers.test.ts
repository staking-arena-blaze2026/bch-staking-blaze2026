import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedProviders,ProviderVerificationError} from '../src/verified-providers.js';
import type {ElectrumCore,Header} from '../src/electrum-core.js';
const peers=['wss://a.test','wss://b.test','wss://c.test'];
const header=(height:number,hash='chain-'+height)=>({height,hash} as Header);
function fixture(){const calls:string[]=[],offline=new Set<string>(),tips=new Map<string,Header>();let selected='';const p={tip:async()=>tips.get(selected)??header(100),session:async(f:()=>Promise<unknown>,peer:string)=>{selected=peer;calls.push(peer);if(offline.has(peer))throw Error('offline');return f();},verifyHeaderChain:async(_h:number,_tip:Header,map:Map<number,string>)=>{if([...map.values()].some(hash=>hash.startsWith('fork')))throw Error('Header chain mismatch');}} as unknown as ElectrumCore;return {p,calls,offline,tips,get selected(){return selected;}};}
const result=(height=100,identity='same',hash?:string)=>({tip:header(height,hash),identity,value:{height,identity}});
test('all three sources independently checked; two matching verified reads authorize',async()=>{const f=fixture();assert.equal((await verifiedProviders(f.p,peers,async()=>result())).height,100);assert.deepEqual(f.calls,peers);});
test('first two differ, third verifies current chain; lag is proved by linked headers',async()=>{const f=fixture();f.tips.set(peers[1]!,header(99));const value=await verifiedProviders(f.p,peers,async peer=>peer===peers[1]?result(99,'old'):result());assert.equal(value.height,100);assert.equal(f.calls.length,4);});
test('offline first provider permits two independently checked sources',async()=>{const f=fixture();assert.equal((await verifiedProviders(f.p,peers,async peer=>{if(peer===peers[0])throw Error('timeout');return result();})).height,100);});
test('same height fork and linked-header fork block even with matching majority',async()=>{for(const height of [99,100]){const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>peer===peers[1]?result(height,'fork','fork-'+height):result()),e=>e instanceof ProviderVerificationError&&e.category==='conflict');}});
test('verified double-spend cannot be masked by other providers',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>{if(peer===peers[2])throw Error('Known double-spend conflict in ancestor history');return result();}),/Conflicting blockchain evidence/);});
test('propagation delay retries full reads; unresolved disagreement is bounded',async()=>{const f=fixture();let count=0;const value=await verifiedProviders(f.p,peers,async()=>result(100,count++<3?'mempool-'+count:'settled'),{sleep:async()=>{}});assert.equal(value.identity,'settled');assert.equal(count,6);count=0;await assert.rejects(verifiedProviders(f.p,peers,async()=>result(100,String(count++)),{sleep:async()=>{}}),/synchronizing/);assert.equal(count,9);});
test('one verified provider never authorizes',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>{if(peer!==peers[0])throw Error('offline');return result();},{sleep:async()=>{}}),/second verified provider/);});
test('two lagging providers cannot overrule a newer verified snapshot',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>peer===peers[2]?result(101,'new'):result(),{sleep:async()=>{}}),/synchronizing/);});
test('a verified pending transition cannot be voted away by two empty mempools',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>result(100,peer===peers[2]?'verified-child':'verified-parent'),{sleep:async()=>{}}),/synchronizing/);});

test('a proved fork remains blocked through provider outage and clears only after compatible evidence',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>result(100,peer===peers[2]?'fork':'same',peer===peers[2]?'fork-100':undefined)),/Conflicting/);f.offline.add(peers[2]!);await assert.rejects(verifiedProviders(f.p,peers,async()=>result()),/Conflicting/);f.offline.clear();assert.equal((await verifiedProviders(f.p,peers,async()=>result())).height,100);assert.equal(f.p.unresolvedChainPeers.size,0);});

test('a provider retreating to an earlier tip inside a read is a reorganization',async()=>{const f=fixture();await assert.rejects(verifiedProviders(f.p,peers,async peer=>peer===peers[0]?result(99,'retreated'):result()),/Conflicting blockchain evidence/);assert.ok(f.p.unresolvedChainPeers.size);});

test('parallel verification uses independent transports and still waits for a slow conflicting third source',async()=>{
 const f=fixture(),started:string[]=[],release:{done?:()=>void}={};
 const barrier=new Promise<void>(resolve=>{release.done=resolve;});
 Object.assign(f.p,{requestCounts:{}}); // Fixture only: production counters live on each provider.
 const sources=new Map(peers.map(peer=>[peer,{requestCounts:{},tip:async()=>header(100),session:async(work:()=>Promise<unknown>)=>{started.push(peer);if(started.length===3)release.done!();await barrier;return work();}}]));
 f.p.independentReader=peer=>sources.get(peer) as ElectrumCore;
 await assert.rejects(verifiedProviders(f.p,peers,async(peer,source)=>{
  assert.equal(source,sources.get(peer));if(peer===peers[2]){await new Promise(r=>setTimeout(r,10));return result(100,'fork','fork-100');}return result();
 },{parallel:true}),/Conflicting/);assert.equal(started.length,3);
});
