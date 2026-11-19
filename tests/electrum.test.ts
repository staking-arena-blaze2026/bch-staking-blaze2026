import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { encodeTransaction, binToHex } from '@bitauth/libauth';
import { ElectrumProvider, decodeRawTransaction, headerHash, scriptHash } from '../src/electrum.js';
import { ElectrumIndexer } from '../src/indexer-core.js';
import { Indexer } from '../src/indexer.js';
import { api, vaultView } from '../src/api.js';
import { json, records } from '../src/arena.js';

process.env.ARENA_NETWORK = 'chipnet';
process.env.BCH_RPC_COOKIE = '/nonexistent-electrum-test-cookie';
import { fixture, Replay, headers, heights } from './fixtures/electrum-replay.js';

test('wire decoding preserves exact CashToken amounts, NFT category/commitment, and satoshis', () => {
  const tx = {version:2,locktime:0,inputs:[{outpointIndex:0,outpointTransactionHash:new Uint8Array(32).fill(3),sequenceNumber:0xffffffff,unlockingBytecode:new Uint8Array()}],outputs:[{lockingBytecode:new Uint8Array([81]),valueSatoshis:2100000000000000n,token:{category:new Uint8Array(32).fill(7),amount:9223372036854775807n,nft:{capability:'mutable' as const,commitment:new Uint8Array([1,2,3])}}}]};
  const decoded = decodeRawTransaction(binToHex(encodeTransaction(tx)));
  assert.equal(decoded.vout[0]!.satoshis,'2100000000000000');
  assert.deepEqual(decoded.vout[0]!.tokenData,{category:'07'.repeat(32),amount:'9223372036854775807',nft:{capability:'mutable',commitment:'010203'}});
  assert.throws(()=>decodeRawTransaction(decoded.hex,'00'.repeat(32)),/mismatch/);
});
test('reported UTXOs use token-aware index data and reject malformed funding hints',async()=>{
 const p=new Replay(),script='51',tx_hash='03'.repeat(32);
 const base={tx_hash,tx_pos:0,value:1200,height:42,token_data:{category:'01'.repeat(32),amount:'9223372036854775807',nft:{capability:'mutable',commitment:'1a'.repeat(121)}}};
 let rows:unknown=[base];
 p.request=async(method,...params)=>{assert.equal(method,'blockchain.scripthash.listunspent');assert.deepEqual(params,[scriptHash(script),'include_tokens']);return rows;};
 const [coin]=await p.getUtxoCandidates(script);
 assert.equal(coin?.lockingBytecode,script);assert.equal(coin?.satoshis,1200n);
 assert.equal(coin?.token?.amount,9223372036854775807n);assert.equal(coin?.token?.nft?.commitment,base.token_data.nft.commitment);
 for(const update of [
  {tx_pos:-1},{tx_hash:'xyz'},{value:2_100_000_000_000_001},{height:-2},
  {token_data:{...base.token_data,category:'xyz'}},{token_data:{...base.token_data,amount:'9223372036854775808'}},
  {token_data:{...base.token_data,amount:17}},{token_data:{...base.token_data,nft:{...base.token_data.nft,commitment:'a'}}},
  {token_data:{...base.token_data,nft:{...base.token_data.nft,capability:'invalid'}}},
 ]){
  rows=[{...base,...update}];await assert.rejects(()=>p.getUtxoCandidates(script),/Malformed/);
 }
 rows=[base,base];await assert.rejects(()=>p.getUtxoCandidates(script),/Duplicate/);
});

test('stored inclusion requires matching live block and remains scoped to the provider',async()=>{
  const id=fixture.configs[0].genesis,height=heights.get(id)!;
  const source=new Replay(),confirmed=await source.transaction(id,height,true);
  const saved=structuredClone(source.exportInclusion(source.endpoint));
  assert.equal(saved.length,1);
  const restarted=new Replay(),request=restarted.request;
  const calls:string[]=[];
  restarted.request=(method,...args)=>{calls.push(method);return request(method,...args);};
  restarted.restoreInclusion(restarted.endpoint,saved);
  assert.deepEqual(await restarted.transaction(id,height,true),confirmed);
  assert.deepEqual(calls,['blockchain.block.header']);
  const another=new Replay();another.endpoint='fixture://other';
  another.restoreInclusion(source.endpoint,saved);another.corruptProof=true;
  await assert.rejects(()=>another.transaction(id,height,true),/proof mismatch/);
  const forked=new Replay(),original=headers.get(height)!;
  forked.restoreInclusion(forked.endpoint,saved);forked.corruptProof=true;
  forked.forks.set(height,original.slice(0,-2)+(original.endsWith('00')?'01':'00'));
  await assert.rejects(()=>forked.transaction(id,height,true),/proof mismatch/);
});

test('captured real chipnet vault: lineage, immutable snapshot, allocations, withdrawal, restart and API routes without BCHN',async()=>{
  const dir = await mkdtemp(join(tmpdir(),'electrum-replay-'));
  const provider = new Replay(); provider.reverseHistory = true;
  const index = new Indexer(fixture.configs,join(dir,'checkpoint.json'),provider);
  try {
    await index.sync();
    assert.equal(index.vaults[0]!.witness,fixture.expected.vaults[0].witness);
    assert.deepEqual(index.vaults[0]!.history.map(h=>h.action),[0,2,3]);
    assert.equal(index.vaults[0]!.allocations[0]!.withdrawal,fixture.expected.vaults[0].allocations[0].withdrawal);
    const v = index.vaults[0]!;
    assert.deepEqual(records(Buffer.from(v.witness,'hex'),true), records(Buffer.from(v.history.find(h=>h.action===3)!.witness,'hex'),true));
    const before = json(index.vaults), restarted = new Indexer(fixture.configs,index.path,new Replay());
    await restarted.load(); assert.equal(restarted.vaults.length,0);
    await restarted.sync(); assert.equal(json(restarted.vaults),before);
    const server = api(restarted); server.listen(0,'127.0.0.1'); await once(server,'listening');
    const address = server.address() as {port:number}, base = `http://127.0.0.1:${address.port}`;
    try {
      for (const path of ['/health','/vaults',...['','/offers','/rankings','/periods','/allocations','/withdrawals','/history'].map(p=>`/vaults/${index.vaults[0]!.category}${p}`)]) {
        const result = await fetch(base+path); assert.equal(result.status,200,path); assert.equal((await result.json()).confirmedOnly,true);
      }
      const transaction = await fetch(base+'/transactions/'+fixture.configs[0].genesis);
      assert.equal(transaction.status,200); assert.equal((await transaction.json()).status,'confirmed');
      assert.equal((await fetch(base+'/transactions/plan',{method:'POST'})).status,405);
      restarted.health.updatedAt = new Date(Date.now()-120000).toISOString();
      const health = await fetch(base+'/health'); assert.equal(health.status,503); assert.equal((await health.json()).health.stale,true);
    } finally { server.close(); await once(server,'close'); }
    assert.equal(vaultView(index,index.vaults[0]!.category)!.bchSatoshis,'151000');
    let failPersistence=false;
    const portable=new ElectrumIndexer(fixture.configs,new Replay(),{load:async()=>undefined,save:async()=>{if(failPersistence)throw Error('Atomic checkpoint failed');}});
    await portable.sync();const committed=json(portable.vaults);failPersistence=true;
    await assert.rejects(portable.sync(),/Atomic checkpoint failed/);assert.equal(json(portable.vaults),committed);assert.equal(portable.health.stale,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('reorganizations roll back confirmed lineage and withdrawals; recovery replays the canonical branch',async()=>{
  const provider = new Replay(), index = new Indexer(fixture.configs,undefined,provider);
  await index.sync(); const before = json(index.vaults);
  provider.height = heights.get(fixture.configs[0].genesis)!;
  await index.sync();
  assert.equal(index.vaults[0]!.history.length,0); assert.equal(index.vaults[0]!.allocations.length,0);
  assert.equal(index.tip!.height,provider.height);
  provider.height = fixture.expected.tip.height; await index.sync(); assert.equal(json(index.vaults),before);
  // A replacement branch at the same tip height drops the later withdrawal, retaining settlement.
  provider.cutoff = 331820;
  let previous = headerHash(headers.get(331820)!);
  for (let height=331821; height<=provider.height; height++) {
    const bytes = Buffer.from(headers.get(height)!, 'hex');
    Buffer.from(previous,'hex').reverse().copy(bytes,4); bytes.writeUInt32LE((bytes.readUInt32LE(76)^1)>>>0,76);
    const hex = bytes.toString('hex'); provider.forks.set(height,hex); previous=headerHash(hex);
  }
  await index.sync();
  assert.equal(index.vaults[0]!.history.length,3); assert.equal(index.vaults[0]!.allocations[0]!.withdrawal,undefined);
  assert.notEqual(index.tip!.hash,fixture.expected.tip.hash);
  provider.cutoff=undefined; provider.forks.clear(); await index.sync(); assert.equal(json(index.vaults),before);
});

test('disconnects, stale tips, invalid proofs and changed ancestry fail closed, preserving last committed state',async()=>{
  const provider = new Replay(), index = new Indexer(fixture.configs,undefined,provider);
  await index.sync(); const before = json(index.vaults);
  provider.fail='disconnected'; await assert.rejects(index.sync(),/disconnected/); assert.equal(json(index.vaults),before); assert.equal(index.health.stale,true);
  provider.fail=''; provider.corruptProof=true; await assert.rejects(index.sync(),/proof mismatch/);
  provider.corruptProof=false; provider.omit=fixture.expected.vaults[0].history[1].txid;
  await assert.rejects(index.sync(),/Canonical UTXO unavailable/); assert.equal(json(index.vaults),before); provider.omit=undefined;
  // The existing provider already linked this exact tip. Exercise corruption
  // on a cold provider so it must fetch and validate the header range.
  const badHeaders=new Replay();badHeaders.corruptHeader=true;
  await assert.rejects(new ElectrumIndexer(fixture.configs,badHeaders).sync(),/Header chain mismatch/);
  provider.pending=true; await index.sync(); assert.deepEqual(index.health.unconfirmed,['ab'.repeat(32)]); assert.equal(json(index.vaults),before);
  const stale = new ElectrumProvider({maxTipAgeSeconds:1}); stale.request=provider.request;
  await assert.rejects(stale.tip(),/Stale/);
  await assert.rejects(stale.sendRawTransaction('00'),/disabled|temporarily unavailable/);
  assert.equal(new ElectrumProvider({network:'mainnet'}).network,'mainnet');
  for(const [options,error] of [[{maxHistoryEntries:1},/history exceeds/],[{maxTransactions:1},/history exceeds/],[{maxRawBytes:10},/byte limit/]] as const) {
    await assert.rejects(new ElectrumIndexer(fixture.configs,new Replay(options)).sync(),error);
  }
});

test('protocol negotiation, chipnet identity, timeout, reconnect and server failover use the real socket transport',async()=>{
  const replay = new Replay(), sockets = new Set<import('node:net').Socket>();
  const server = createServer(socket=>{
    sockets.add(socket); socket.once('close',()=>sockets.delete(socket)); let buffer='';
    socket.on('data',data=>{buffer+=data;let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const request=JSON.parse(line);void replay.request(request.method,...request.params).then(result=>socket.write(JSON.stringify({id:request.id,result})+'\n'));}});
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const endpoint=`tcp://127.0.0.1:${(server.address() as {port:number}).port}`;
  const hanging = createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  hanging.listen(0,'127.0.0.1'); await once(hanging,'listening');
  const provider = new ElectrumProvider({endpoints:[`tcp://127.0.0.1:${(hanging.address() as {port:number}).port}`,endpoint],timeoutMs:100,maxTipAgeSeconds:Number.MAX_SAFE_INTEGER});
  try {
    for(let i=0;i<2;i++) assert.equal(await provider.session(()=>provider.getBlockHeight()),fixture.expected.tip.height);
    assert.equal(provider.endpoint,endpoint);
    assert.equal(headerHash(headers.get(121957)!), '0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78');
  } finally { for(const socket of sockets)socket.destroy(); server.close();hanging.close(); }
});
