import test from 'node:test';
import assert from 'node:assert/strict';
import {binToHex} from '@bitauth/libauth';
import {SignatureTemplate} from 'cashscript';
import {ElectrumCore} from '../src/electrum-core.js';
import {scanWallet} from '../src/electrum-wallet.js';
import {WalletFixture} from './fixtures/wallet-chain.js';

function harness(){
 const f=new WalletFixture(),messages:string[]=[],delays:number[]=[];
 const options={onProgress:(s:string)=>messages.push(s),sleep:async(ms:number)=>{delays.push(ms);}};
 return {f,messages,delays,options};
}
test('wallet scan retries a proven new block and preserves BCH, fungible tokens and NFTs',async()=>{
 const {f,messages,delays,options}=harness(),request=f.chain.request;let changed=false;
 f.chain.request=async(method,...params)=>{const result=await request(method,...params);if(!changed&&method==='blockchain.scripthash.listunspent'){changed=true;f.chain.mine([]);}return result;};
 const inventory=await scanWallet(f.engine.provider,f.keys,options);
 assert.equal(inventory.bch,'250000');assert.equal(inventory.tokens[f.asset],'2500');assert.equal(inventory.tokens[f.other],'5000');assert.ok(inventory.coins.some(c=>c.utxo.token?.nft?.commitment==='12'));
 assert.ok(messages.some(s=>/synchronizing|normal blockchain extension/.test(s)));assert.deepEqual(delays,[1000]);assert.equal(f.chain.broadcasts.length,0);
});
test('wallet scan rejects snapshots at different tips even when a block arrives between providers',async()=>{
 const {f,messages,options}=harness(),request=f.chain.request;let sessions=0;
 f.chain.request=async(method,...params)=>{if(method==='server.version'&&++sessions===2)f.chain.mine([]);return request(method,...params);};
 const inventory=await scanWallet(f.engine.provider,f.keys,options);
 assert.equal(inventory.tokens[f.asset],'2500');assert.equal(new Set(f.chain.requestLog.map(r=>r.endpoint)).size,2);
});
test('wallet scan discards a replaced-tip scan and independently verifies a fresh snapshot',async()=>{
 const {f,messages,delays,options}=harness();f.chain.mine([]);const request=f.chain.request;let changed=false;
 f.chain.request=async(method,...params)=>{const result=await request(method,...params);if(!changed&&method==='blockchain.scripthash.listunspent'){changed=true;f.chain.reorgLastBlock();f.chain.time++;f.chain.mine([]);}return result;};
 assert.equal((await scanWallet(f.engine.provider,f.keys,options)).tokens[f.asset],'2500');
 assert.deepEqual(delays,[1000]);assert.ok(messages.some(s=>s.includes('Snapshot discarded')));assert.equal(f.chain.broadcasts.length,0);
});
test('wallet scan fails closed on repeated reorganizations with bounded retries and actionable progress',async()=>{
 const {f,messages,delays,options}=harness();f.chain.mine([]);const request=f.chain.request;let subscriptions=0;
 f.chain.request=async(method,...params)=>{if(method==='blockchain.headers.subscribe'&&++subscriptions%2===0){f.chain.reorgLastBlock();f.chain.time++;f.chain.mine([]);}return request(method,...params);};
 await assert.rejects(scanWallet(f.engine.provider,f.keys,options),/after 3 attempts.*No scan data is usable/);
 assert.deepEqual(delays,[1000,2000]);assert.ok(subscriptions>=6);assert.equal(f.chain.broadcasts.length,0);
});
test('wallet scan never promotes provider disagreement to a verified balance',async()=>{
 const {f,delays,options}=harness();f.chain.disagree=true;
 await assert.rejects(scanWallet(f.engine.provider,f.keys,options),/after 3 attempts.*second verified provider/);assert.deepEqual(delays,[1000,2000]);assert.equal(f.chain.broadcasts.length,0);
});
test('wallet scan outage is bounded and gives a connection/retry instruction',async()=>{
 const {f,delays,options}=harness();f.chain.fail=true;
 await assert.rejects(scanWallet(f.engine.provider,f.keys,options),/after 3 attempts.*check your connection.*second verified provider/);assert.deepEqual(delays,[1000,2000]);
});
test('wallet scan transient outage automatically recovers and verifies both hosts',async()=>{
 const {f,messages,options}=harness();f.chain.fail=true;
 const inventory=await scanWallet(f.engine.provider,f.keys,{...options,sleep:async()=>{f.chain.fail=false;}});
 assert.equal(inventory.tokens[f.asset],'2500');assert.ok(messages.some(s=>s.includes('attempt 2/3')));
 assert.equal(new Set(f.chain.requestLog.map(r=>r.endpoint)).size,2);
});
test('wallet scan includes funded addresses after an unused gap and links shared proof headers once per provider',async()=>{
 const {f,options}=harness();const funded={...f.keys[1],path:'receive' as const,index:25};
 const keys=Array.from({length:25},(_,i)=>({path:'receive' as const,index:i,publicKey:binToHex(new SignatureTemplate(new Uint8Array(32).fill(80+i)).publicKey)}));keys.push(funded);
 const inventory=await scanWallet(f.engine.provider,keys,options);
 assert.equal(inventory.addresses,26);assert.equal(inventory.tokens[f.asset],'2500');assert.equal(inventory.bch,'250000');
 assert.equal(f.chain.requestLog.filter(r=>r.method==='blockchain.block.headers').length,2);
});
test('failed refresh clears an earlier engine inventory and blocks creation from stale balances',async()=>{
 const {f}=harness();await f.engine.scan(f.keys);assert.ok(f.engine.inventory);f.chain.fail=true;
 await assert.rejects(f.engine.scan(f.keys),/after 3 attempts/);assert.equal(f.engine.inventory,undefined);
 await assert.rejects(f.engine.create(f.parameters(),f.keys),/balances first/);assert.equal(f.journal.size,0);assert.equal(f.chain.broadcasts.length,0);
});

test('wallet scan rejects individually valid but different provider UTXO inventories',async()=>{
 const {f,options}=harness(),base=f.engine.provider;
 const provider=new ElectrumCore((endpoint,timeout)=>{
  const connection=base.connectionFactory(endpoint,timeout),request=connection.request;
  connection.request=async(method,...params)=>{const result=await request(method,...params);return endpoint.includes('second')&&method==='blockchain.scripthash.listunspent'?[]:result;};
  return connection;
 },{endpoints:base.endpoints});
 await assert.rejects(scanWallet(provider,f.keys,options),/after 3 attempts.*second verified provider/);
 assert.equal(f.chain.broadcasts.length,0);
});
test('wallet scan uses distinct concurrent provider sessions and returns only matching snapshots',async()=>{
 const {f,options}=harness(),request=f.chain.request;let sessions=0,active=0,maximum=0;
 f.chain.request=async(method,...params)=>{if(method==='server.version')sessions++;if(method!=='blockchain.scripthash.listunspent')return request(method,...params);
  active++;maximum=Math.max(maximum,active);try{await new Promise(r=>setTimeout(r,5));return await request(method,...params);}finally{active--;}
 };
 assert.equal((await scanWallet(f.engine.provider,f.keys,options)).tokens[f.asset],'2500');
 assert.equal(sessions,2);assert.ok(maximum>=2);assert.equal(new Set(f.chain.requestLog.map(r=>r.endpoint)).size,2);
});
