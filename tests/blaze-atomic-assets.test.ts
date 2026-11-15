import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate,TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {AssetWallet,type Operation} from '../src/v3/wallet.js';
import {ownerAddress,type Parameters} from '../src/v3/protocol.js';
import type {BrowserPlan,WalletKey} from '../src/transactions-core.js';

test('BCHN attack probes: wallet review excludes NFTs; covenant rejects unrelated tokens, burns and stake diversion',{timeout:300000},async()=>isolatedRegtest(async()=>{
 class Local extends RegtestElectrum {override async sendRawTransaction(raw:string){const [valid]=await rpc('testmempoolaccept',[[raw]]);assert.equal(valid.allowed,true,JSON.stringify(valid));const id=await rpc<string>('sendrawtransaction',[raw]);await this.refresh();return id;}}
 const p=new Local(await rpc('getblockcount')),key=new SignatureTemplate(new Uint8Array(32).fill(239)),owner=ownerAddress(key.publicKey,p),miner=await rpc('getnewaddress');
 const keys:WalletKey[]=[{publicKey:binToHex(key.publicKey),path:'receive',index:0}],rows=new Map<string,Operation>();
 const wallet=new AssetWallet(p,{list:async()=>structuredClone([...rows.values()]),save:async o=>{rows.set(o.id,structuredClone(o));}});
 function sign(plan:BrowserPlan){const tx=structuredClone(plan.request.transaction) as Transaction;
  for(const [i]of plan.inputPaths){const s=plan.request.sourceOutputs[i]!,sig=key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:plan.request.sourceOutputs,inputIndex:i},{coveredBytecode:s.contract?.redeemScript??s.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;
   tx.inputs[i]!.unlockingBytecode=s.contract?hexToBin(binToHex(s.unlockingBytecode).replace('41'+'00'.repeat(65),'41'+binToHex(sig))):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(key.publicKey)]);}
  return binToHex(encodeTransaction(tx));
 }
 async function fund(){const raw=await rpc('createrawtransaction',[[],{[owner]:0.02}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]),id=await rpc('sendrawtransaction',[signed.hex]);await p.refresh();return utxo(await p.transactionStatus(id),0);}
 const seed=await fund();
 const mint=new TransactionBuilder({provider:p}).addInput(seed,key.unlockP2PKH())
 .addOutput({to:owner,amount:seed.satoshis-12000n,token:{category:seed.txid,amount:100000n}})
 .addOutput({to:owner,amount:1000n,token:{category:seed.txid,amount:0n,nft:{capability:'none',commitment:''}}})
 .addOutput({to:miner,amount:1000n});
 const mintId=await rpc('sendrawtransaction',[mint.build()]);await p.refresh();
 const otherSeed=await fund(),otherMint=new TransactionBuilder({provider:p}).addInput(otherSeed,key.unlockP2PKH()).addOutput({to:owner,amount:otherSeed.satoshis-10000n,token:{category:otherSeed.txid,amount:100n}});
 const otherId=await rpc('sendrawtransaction',[otherMint.build()]);await fund();await rpc('generatetoaddress',[1,miner]);p.headerCache.clear();await p.refresh();
 const params:Parameters={version:3,registryVersion:4,stakingAsset:{kind:'token',category:seed.txid},rewardAsset:{kind:'bch'},epoch:(await rpc('getblockchaininfo')).mediantime-1000,periodSeconds:100,periods:4,cap:2000n};
 const creation=await wallet.create(params,keys);assert.equal(creation.creationMode,'direct');await wallet.authorize(creation.id);const created=await wallet.submit(creation.id,sign(creation.plan!));assert.equal(created.stage,'pending',created.error);await p.refresh();
 const offer=await wallet.offer(created.config!,{stake:2000n,duration:3600,reward:1000n,maxWins:1},keys),auth=await wallet.authorize(offer.id);
 const selected=auth.plan.request.sourceOutputs.slice(3);assert.equal(selected.some(s=>!!s.token?.nft),false);assert.equal(selected.some(s=>s.token&&binToHex(s.token.category)!==seed.txid),false);
 const rejected=async(label:string,mutate:(plan:BrowserPlan)=>void)=>{const plan=structuredClone(auth.plan);mutate(plan);const raw=sign(plan),[result]=await rpc('testmempoolaccept',[[raw]]);if(label==='NFT with empty commitment'){assert.equal(result.allowed,true,'immutable empty NFTs are indistinguishable from fungible-only inputs to token introspection');await assert.rejects(()=>wallet.submit(offer.id,raw),/Wallet changed inputs/);}else assert.equal(result.allowed,false,label);};
 await rejected('token burn',plan=>{const tx=plan.request.transaction as Transaction;tx.outputs.find((o,i)=>i>=3&&o.token)!.token!.amount--;});
 await rejected('underfunded stake',plan=>{const tx=plan.request.transaction as Transaction;tx.outputs[1]!.token!.amount--;tx.outputs.find((o,i)=>i>=3&&o.token)!.token!.amount++;});
 await rejected('token change diversion',plan=>{const tx=plan.request.transaction as Transaction;tx.outputs.find((o,i)=>i>=3&&o.token)!.lockingBytecode=hexToBin('76a914'+'12'.repeat(20)+'88ac');});
 for(const [label,id,vout]of [['NFT with empty commitment',mintId,1],['unrelated fungible tokens',otherId,0]] as const){
  const tx=await p.transactionStatus(id),coin=utxo(tx,vout);
  await rejected(label,plan=>{const transaction=plan.request.transaction as Transaction,index=transaction.inputs.length;
   transaction.inputs.push({...structuredClone(transaction.inputs[3]!),outpointTransactionHash:hexToBin(id),outpointIndex:vout});
   plan.request.sourceOutputs.push({...transaction.inputs[index]!,valueSatoshis:coin.satoshis,lockingBytecode:hexToBin(coin.lockingBytecode!),unlockingBytecode:new Uint8Array(),token:{category:hexToBin(coin.token!.category),amount:coin.token!.amount,...(coin.token!.nft?{nft:{capability:coin.token!.nft.capability,commitment:hexToBin(coin.token!.nft.commitment)}}:{})}});
   plan.inputPaths.push([index,'receive',0]);plan.signers[index]=keys[0]!.publicKey;transaction.outputs[transaction.outputs.length-1]!.valueSatoshis+=coin.satoshis;
  });
 }
 const [valid]=await rpc('testmempoolaccept',[[sign(auth.plan)]]);assert.equal(valid.allowed,true,JSON.stringify(valid));
},18450));
