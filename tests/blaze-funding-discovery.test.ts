import test from 'node:test';
import assert from 'node:assert/strict';
import {Network,SignatureTemplate} from 'cashscript';
import {discoverFunding} from '../src/v3/funding-discovery.js';
import {walletScript,type WalletKey} from '../src/transactions-core.js';
import type {ElectrumCore} from '../src/electrum-core.js';
const keys:WalletKey[]=Array.from({length:40},(_,index)=>({path:'receive',index,publicKey:Buffer.from(new SignatureTemplate(new Uint8Array(32).fill(index+1)).publicKey).toString('hex')}));
function fixture(){let endpoint='',calls=0,disagree=false;const funded=new Set([0]);
 const provider={network:Network.REGTEST,endpoints:['mock://one','mock://two'],async session<T>(work:()=>Promise<T>,peer:string){endpoint=peer;return work();},async tip(){return {hash:'a',height:1};},async getUtxosForLockingBytecode(script:string){calls++;const index=keys.findIndex(k=>walletScript(k.publicKey)===script);return funded.has(index)&&!(disagree&&endpoint.includes('two'))?[{txid:String(index).padStart(64,'0'),vout:0,satoshis:100000n,lockingBytecode:script}]:[];}} as unknown as ElectrumCore;
 return {provider,funded,calls:()=>calls,disagree:()=>{disagree=true;}};
}
test('adaptive discovery stops early and cache remains a hint; empty addresses are revisited',async()=>{
 const f=fixture(),enough=(coins:unknown[])=>coins.length>0;
 assert.equal((await discoverFunding(f.provider,keys,enough)).addresses,6);assert.equal(f.calls(),12);
 f.funded.clear();f.funded.add(39);assert.equal((await discoverFunding(f.provider,keys,enough)).addresses,40);
 const before=f.calls();assert.equal((await discoverFunding(f.provider,keys,enough)).addresses,6);assert.equal(f.calls()-before,12);
 f.funded.clear();f.funded.add(0);assert.ok((await discoverFunding(f.provider,keys,enough)).coins.some(c=>c.index===0));
});
test('discovery withholds contradictory independent provider observations',async()=>{
 const f=fixture();f.disagree();await assert.rejects(()=>discoverFunding(f.provider,keys,coins=>coins.length>0),/synchronizing/);
});
test('full supplied bound is searched without an unused gap assumption',async()=>{
 const f=fixture();f.funded.clear();assert.equal((await discoverFunding(f.provider,keys,()=>false)).addresses,40);assert.equal(f.calls(),80);
});
test('change-path funds and deep indices remain discoverable; a small scan does not pretend to cover them',async()=>{
 const f=fixture();f.funded.clear();f.funded.add(39);
 const small=await discoverFunding(f.provider,keys.slice(0,2),coins=>coins.length>0);assert.equal(small.coins.length,0);assert.equal(small.addresses,2);
 const deep=await discoverFunding(f.provider,keys,coins=>coins.length>0);assert.ok(deep.coins.some(c=>c.index===39));assert.equal(deep.queried.length,40);
 const change=keys.map(k=>({...k,path:'change' as const}));f.funded.clear();f.funded.add(0);assert.equal((await discoverFunding(f.provider,change,coins=>coins.length>0)).coins[0]!.path,'change');
});
test('a journal-funded child beyond the initial bound is queried before unrelated addresses',async()=>{
 const f=fixture();f.funded.clear();f.funded.add(39);const input=[...keys.slice(0,6),{...keys[39]!,fundingHint:true}];
 const found=await discoverFunding(f.provider,input,coins=>coins.length>0);assert.equal(found.addresses,6);assert.equal(found.queried[0]!.index,39);assert.equal(found.coins[0]!.index,39);
});
