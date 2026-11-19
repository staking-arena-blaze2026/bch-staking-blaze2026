/** Recovery uses only a fresh isolated BCHN. Public transports are prohibited. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,hashTransaction,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {walletAddress,type BrowserPlan} from '../src/transactions-core.js';
import {QueueWallet,type Operation} from '../src/queue/wallet.js';
import {QueueIndexer} from '../src/queue/chain.js';
import {ZERO,ownerScript,root} from '../src/queue/protocol.js';
for(const network of ['mainnet','chipnet'] as const)for(const scenario of ['complete','existing-covenant','covenant-during-confirmation'])test(network+': legacy wallet resolution '+scenario,{timeout:240000},async()=>isolatedRegtest(async({restartWithoutMempool})=>{
 class Local extends RegtestElectrum {broadcasts=0;override async sendRawTransaction(raw:string){const [accepted]=await rpc('testmempoolaccept',[[raw]]);assert.equal(accepted.allowed,true,JSON.stringify(accepted));const id=await rpc<string>('sendrawtransaction',[raw]);this.broadcasts++;await this.refresh();return id;}}
 const p=new Local(await rpc('getblockcount'));p.network=network as typeof p.network;const request=p.request;p.request=async(m,...a)=>m==='blockchain.relayfee'?0.00001:request(m,...a);
 const signer=new SignatureTemplate(new Uint8Array(32).fill(84)),key={publicKey:binToHex(signer.publicKey),path:'receive' as const,index:0},keys=[key],address=walletAddress(signer.publicKey,'regtest'),miner=await rpc<string>('getnewaddress');
 const saved=new Map<string,Operation>(),store={list:async()=>structuredClone([...saved.values()]),save:async(o:Operation)=>{saved.set(o.id,structuredClone(o));}};let wallet=new QueueWallet(p,store);
 const parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:600,releases:8,cap:1200n};
 async function fund(sats:number,nonGenesis=false){const raw=await rpc('createrawtransaction',[[],{[address]:sats/1e8}]),f=await rpc('fundrawtransaction',[raw,{changePosition:nonGenesis?0:1}]),s=await rpc('signrawtransactionwithwallet',[f.hex]),id=await rpc<string>('sendrawtransaction',[s.hex]);await p.refresh();return utxo(await p.transactionStatus(id),nonGenesis?1:0);}
 const source=await fund(866420),extra=await fund(1500,true),template=await wallet.prepare({kind:'create',parameters},keys);await wallet.discard(template.id);
 const parentRaw=new TransactionBuilder({provider:p}).addInput(source,signer.unlockP2PKH()).addOutput({to:ownerScript(signer.publicKey),amount:1200n}).addOutput({to:ownerScript(signer.publicKey),amount:865001n}).build(),parentId=await rpc<string>('sendrawtransaction',[parentRaw]);await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 const parent=await p.transactionStatus(parentId),queueCoin=utxo(parent,0),oldInput=utxo(parent,1),covScript=root({p:parameters,identity:{vault:'11'.repeat(32),queue:'22'.repeat(32)},provider:p}).lockingBytecode;
 const oldRaw=new TransactionBuilder({provider:p}).addInput(oldInput,signer.unlockP2PKH()).addOutput({to:hexToBin(covScript),amount:1200n}).addOutput({to:ownerScript(signer.publicKey),amount:862801n}).build(),oldId=hashTransaction(hexToBin(oldRaw));
 const history=[{step:'queue-funding',raw:parentRaw,txid:parentId}];
 const legacy={...template,id:'legacy',step:'seed-funding',stage:'signed',signing:'signed',raw:oldRaw,txid:oldId,sources:[oldInput],queueCoin,reservations:undefined,history,network} as unknown as Operation;saved.set('legacy',structuredClone(legacy));
 if(scenario==='existing-covenant'){
  const donation=await fund(3000),raw=new TransactionBuilder({provider:p}).addInput(donation,signer.unlockP2PKH()).addOutput({to:hexToBin(covScript),amount:2000n}).build(),id=await rpc<string>('sendrawtransaction',[raw]);await p.refresh();
  await assert.rejects(()=>wallet.prepare({kind:'recover',operationId:'legacy'},keys),/already holds covenant funds/);assert.equal(p.broadcasts,0);assert.equal(saved.get('legacy')!.raw,oldRaw);assert.equal((await p.session(()=>p.getUtxosForLockingBytecode(covScript))).some(u=>u.txid===id&&u.satoshis===2000n),true);
  console.log(JSON.stringify({network,existingCovenantProtected:true,untrackedCovenantDetected:true,oldBytesPreserved:true}));return;
 }
 await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),(e:any)=>{assert.equal(e.details.reserved,'866201');assert.equal(e.details.available,'1500');assert.equal(e.details.eligibleGenesis,0);return true;});
 let recovery=await wallet.prepare({kind:'recover',operationId:'legacy'},keys);assert.equal(p.broadcasts,0);assert.equal(recovery.step,'wallet-recovery');assert.equal(recovery.quote!.totalFee,'185');assert.equal(recovery.quote!.recovery!.reservedBch,'866201');assert.equal(recovery.quote!.recovery!.returnedBch,'864816');assert.equal(recovery.sources.length,1);assert.equal(recovery.sources[0]!.txid,parentId);assert.equal(recovery.sources[0]!.vout,1);assert.equal(recovery.plan.request.broadcast,false);
 await assert.rejects(()=>wallet.authorize(recovery.id),/Confirm/);await wallet.discard(recovery.id);assert.equal(saved.get('legacy')!.raw,oldRaw);assert.deepEqual(saved.get('legacy')!.history,history);assert.equal(saved.get('legacy')!.supersededBy,undefined);
 recovery=await wallet.prepare({kind:'recover',operationId:'legacy'},keys);const same=await wallet.prepare({kind:'recover',operationId:'legacy'},keys);assert.equal(same.id,recovery.id,'one resolution journal per old request');
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;for(const [i]of plan.inputPaths){const sig=signer.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:plan.request.sourceOutputs[i]!.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;tx.inputs[i]!.unlockingBytecode=new Uint8Array([...encodeDataPush(sig),...encodeDataPush(signer.publicKey)]);}return binToHex(encodeTransaction(tx));}
 async function approve(o:Operation){if(!o.approved)o=await wallet.confirm(o.id);const auth=await wallet.authorize(o.id);await wallet.beginSigning(o.id);await wallet.retain(o.id,sign(auth.plan).toUpperCase());return wallet.broadcast(o.id);}
 recovery=await approve(recovery);assert.equal(recovery.stage,'pending');assert.equal(p.broadcasts,1);assert.equal(saved.get('legacy')!.supersededBy,undefined,'mempool acknowledgement cannot release old reservations');await wallet.resume(recovery.id,keys,true);assert.equal(p.broadcasts,1,'already observed resolution is not rebroadcast');
 await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),(e:any)=>{assert.equal(e.details.available,'1500');return true;});
 if(scenario==='covenant-during-confirmation'){
  const donation=await fund(3000),raw=new TransactionBuilder({provider:p}).addInput(donation,signer.unlockP2PKH()).addOutput({to:hexToBin(covScript),amount:2000n}).build();await rpc('sendrawtransaction',[raw]);
  // A cached prior-resolution marker must not bypass fresh covenant inspection.
  saved.get('legacy')!.supersededBy=recovery.txid;
 }
 await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();wallet=new QueueWallet(p,store);
 recovery=await wallet.reconcileRecovery(recovery.id);
 if(scenario==='covenant-during-confirmation'){
  assert.equal(recovery.stage,'confirmed');assert.equal(recovery.recoveryResolved,false);assert.match(recovery.error!,/already holds covenant funds/);assert.equal(saved.get('legacy')!.supersededBy,undefined);
  const separate=await wallet.prepare({kind:'create',parameters},keys);assert.equal(separate.quote!.transactions,2);assert.ok(!separate.reservations!.some(u=>u.txid===parentId&&u.vout===0));assert.ok(!separate.sources.some(u=>u.lockingBytecode===covScript));assert.equal(saved.get('legacy')!.raw,oldRaw);assert.equal(p.broadcasts,1);
  console.log(JSON.stringify({network,lateCovenantProtected:true,ordinaryFundsRemainUsable:true,confirmedResolution:true,oldBytesPreserved:true}));return;
 }
 assert.equal(recovery.stage,'confirmed');assert.equal(recovery.recoveryResolved,true);assert.equal(saved.get('legacy')!.supersededBy,recovery.txid);assert.equal(saved.get('legacy')!.stage,'conflict');assert.equal(saved.get('legacy')!.raw,oldRaw);assert.deepEqual(saved.get('legacy')!.history,history);
 const creation=await wallet.prepare({kind:'create',parameters},keys);assert.equal(creation.quote!.transactions,1);assert.equal(creation.quote!.reserve,'9600');assert.equal(BigInt(creation.quote!.walletDebit)+BigInt(recovery.quote!.totalFee),13917n);
 const created=await approve(creation);assert.equal(p.broadcasts,2);assert.equal((await new QueueIndexer(p,created.config!).sync()).state.reserve,9600n);
 // A reorg must restore protection instead of trusting the old resolved flag.
 await rpc('invalidateblock',[await rpc('getbestblockhash')]);await restartWithoutMempool();p.headerCache.clear();await p.refresh();
 await assert.rejects(()=>wallet.prepare({kind:'create',parameters},keys),/old request reserves|Vault creation funding/i);await wallet.reconcileRecovery(recovery.id);await wallet.resume('legacy',keys);assert.equal(saved.get('legacy')!.reservationResolution,'unresolved');assert.equal(saved.get(recovery.id)!.recoveryResolved,false);assert.equal(saved.get('legacy')!.raw,oldRaw);
 // If the original transaction wins, recovery cannot touch its covenant output.
 await rpc('sendrawtransaction',[oldRaw]);await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 const lost=await wallet.reconcileRecovery(recovery.id);assert.equal(lost.stage,'conflict');assert.equal(lost.recoveryResolved,false);
 await assert.rejects(()=>wallet.prepare({kind:'recover',operationId:'legacy'},keys),/already on the network|covenant/);
 assert.equal((await p.session(()=>p.getUtxosForLockingBytecode(covScript))).some(u=>u.txid===oldId&&u.satoshis===1200n),true);assert.equal(p.broadcasts,2,'inspection never rebroadcasts the old transaction');assert.equal(saved.get('legacy')!.raw,oldRaw);assert.deepEqual(saved.get('legacy')!.history,history);
 const wrong={...legacy,id:'wrong-network',network:network==='mainnet'?'chipnet':'mainnet'} as Operation;saved.set(wrong.id,wrong);await assert.rejects(()=>wallet.prepare({kind:'recover',operationId:wrong.id},keys),/network journal/);
 console.log(JSON.stringify({network,recoveryFee:recovery.quote!.totalFee,returned:recovery.quote!.recovery!.returnedBch,oldBytesPreserved:true,newReserve:'9600',broadcasts:p.broadcasts,reorgProtection:true,oldTransactionWinsProtected:true}));
},18598,['-expire=0','-upgrade12activationheight=1','-mocktime=1790000000']));
