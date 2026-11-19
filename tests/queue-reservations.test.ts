import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hashTransaction,hexToBin} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {walletAddress} from '../src/transactions-core.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {ZERO,ownerScript,root} from '../src/queue/protocol.js';
for(const network of ['mainnet','chipnet'] as const)test(network+': legacy signed reservations reconcile without broadcasting or destroying evidence',{timeout:120000},async()=>isolatedRegtest(async({restartWithoutMempool})=>{
 const p=new RegtestElectrum(await rpc('getblockcount'));p.network=network as typeof p.network;const request=p.request;
 p.request=async(method,...args)=>method==='blockchain.relayfee'?0.00001:request(method,...args);
 const signer=new SignatureTemplate(new Uint8Array(32).fill(83)),key={publicKey:binToHex(signer.publicKey),path:'receive' as const,index:0},keys=[key],address=walletAddress(signer.publicKey,'regtest'),miner=await rpc<string>('getnewaddress');
 const saved=new Map<string,Operation>(),store={list:async()=>structuredClone([...saved.values()]),save:async(op:Operation)=>{saved.set(op.id,structuredClone(op));}},wallet=new QueueWallet(p,store);
 const parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:600,releases:8,cap:1200n};
 async function fund(sats:number){const raw=await rpc('createrawtransaction',[[],{[address]:sats/1e8}]),f=await rpc('fundrawtransaction',[raw,{changePosition:1}]),s=await rpc('signrawtransactionwithwallet',[f.hex]),id=await rpc<string>('sendrawtransaction',[s.hex]);await p.refresh();return utxo(await p.transactionStatus(id),0);}
 const source=await fund(866420),extra=await fund(1500);
 const template=await wallet.prepare({kind:'create',parameters},keys);await wallet.discard(template.id);
 const b=new TransactionBuilder({provider:p}).addInput(source,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:1200n}).addOutput({to:ownerScript(signer.publicKey),amount:865001n});
 const raw=b.build(),id=hashTransaction(hexToBin(raw));
 const legacy={...template,id:'legacy',step:'seed-funding',stage:'signed',signing:'signed',raw,txid:id,sources:[source],reservations:[source,extra]} as unknown as Operation;
 saved.set(legacy.id,structuredClone(legacy));
 const before=(await rpc<string[]>('getrawmempool')).sort();
 await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),(e:any)=>{
  assert.equal(e.details.code,'creation-funding');assert.equal(e.details.available,'0');assert.equal(e.details.reserved,'867920');assert.equal(e.details.reservations[0].id,'legacy');assert.match(e.message,/Inspect Transaction recovery/);return true;
 });
 assert.equal(saved.get('legacy')!.raw,raw);assert.equal(saved.get('legacy')!.stage,'signed');assert.deepEqual((await rpc<string[]>('getrawmempool')).sort(),before);
 const status=p.transactionStatus.bind(p);let repeatedStatus=0;p.transactionStatus=async txid=>{if(txid===id)repeatedStatus++;return status(txid);};
 await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),/Insufficient wallet funding/);assert.equal(repeatedStatus,0,'quoting from locally reserved outpoints needs no legacy status lookup');p.transactionStatus=status;
 // Safe inspection never rebroadcasts, even when retry was requested.
 const inspected=await wallet.resume('legacy',keys,true);assert.equal(inspected.reservationEvidence?.kind,'verified-unspent-inputs');assert.equal(inspected.reservationEvidence?.bch,'866420');assert.match(inspected.error!,/actual signed input/);assert.deepEqual((await rpc<string[]>('getrawmempool')).sort(),before);
 const unrelated=await fund(50000),newOp=await wallet.prepare({kind:'create',parameters},keys);assert.ok(newOp.sources.some(u=>u.txid===unrelated.txid));assert.ok(!newOp.sources.some(u=>u.txid===source.txid));await wallet.discard(newOp.id);
 // The fixture explicitly broadcasts; reconciliation itself only reads.
 await rpc('sendrawtransaction',[raw]);await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 await wallet.resume('legacy',keys);
 const confirmed=await wallet.prepare({kind:'create',parameters},keys);assert.equal(saved.get('legacy')!.stage,'confirmed');assert.equal(saved.get('legacy')!.reservationResolution,'confirmed');assert.equal(saved.get('legacy')!.raw,raw);await wallet.discard(confirmed.id);
 // A confirmed parent cannot clear reservations for different child inputs.
 const intact=structuredClone(saved.get('legacy')!);saved.get('legacy')!.sources=[extra];
 const mismatch=await wallet.resume('legacy',keys);assert.equal(mismatch.reservationResolution,'unresolved');assert.match(mismatch.error!,/inputs disagree/);assert.equal(mismatch.raw,raw);saved.set('legacy',intact);
 // Independently confirmed ordinary wallet self-sends release wallet-only
 // continuation references without erasing those historical fields.
 saved.get('legacy')!.queueCoin=extra;
 const released=await wallet.prepare({kind:'create',parameters},keys);assert.ok(released.sources.some(u=>u.txid===extra.txid&&u.vout===extra.vout));assert.deepEqual(saved.get('legacy')!.queueCoin,extra);await wallet.discard(released.id);
 // A real isolated non-wallet seed output keeps its linked wallet anchor held.
 const seedSource=await fund(4000),seedScript=root({p:parameters,identity:{vault:'11'.repeat(32),queue:'22'.repeat(32)},provider:p}).lockingBytecode;
 const seedRaw=new TransactionBuilder({provider:p}).addInput(seedSource,signer.unlockP2PKH()).addOutput({to:hexToBin(seedScript),amount:3000n}).build(),seedId=await rpc<string>('sendrawtransaction',[seedRaw]);await p.refresh();
 saved.get('legacy')!.seed=utxo(await p.transactionStatus(seedId),0);
 const anchored=await wallet.prepare({kind:'create',parameters},keys);assert.ok(!anchored.sources.some(u=>u.txid===extra.txid&&u.vout===extra.vout));assert.equal(saved.get('legacy')!.raw,raw);await wallet.discard(anchored.id);delete saved.get('legacy')!.queueCoin;delete saved.get('legacy')!.seed;
 // A confirmed competing spend proves another retained signed candidate cannot execute.
 const otherRaw=new TransactionBuilder({provider:p}).addInput(unrelated,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:49000n}).build();
 saved.set('competing',{...legacy,id:'competing',queueCoin:extra,sources:[unrelated],reservations:[unrelated],raw:otherRaw,txid:hashTransaction(hexToBin(otherRaw))});
 const competitor=new TransactionBuilder({provider:p}).addInput(unrelated,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:48000n}).build();
 await rpc('sendrawtransaction',[competitor]);await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 await wallet.resume('competing',keys);
 const afterConflict=await wallet.prepare({kind:'create',parameters},keys);assert.ok(!afterConflict.sources.some(u=>u.txid===extra.txid&&u.vout===extra.vout));assert.equal(saved.get('competing')!.stage,'conflict');assert.equal(saved.get('competing')!.raw,otherRaw);
 // Reappearance of a wallet source invalidates a cached conflict classification.
 await wallet.discard(afterConflict.id);await rpc('invalidateblock',[await rpc('getbestblockhash')]);await restartWithoutMempool();p.headerCache.clear();await p.refresh();
 const afterReorg=await wallet.prepare({kind:'create',parameters},keys);assert.ok(!afterReorg.sources.some(u=>u.txid===unrelated.txid),'the quote holds reappearing signed inputs pending inspection');
 await wallet.resume('competing',keys);assert.equal(saved.get('competing')!.stage,'signed');assert.equal(saved.get('competing')!.reservationResolution,'unresolved');assert.equal(saved.get('competing')!.raw,otherRaw);

},18588,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
