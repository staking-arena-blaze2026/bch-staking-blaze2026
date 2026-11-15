import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {ElectrumCore,decodeRawTransaction} from '../src/electrum-core.js';
import {BLOCKCHAIN_REFRESH,verifyCoinsAcrossPeers} from '../src/electrum-wallet.js';
import {discoverFunding} from '../src/v3/funding-discovery.js';
import {utxo} from '../src/arena-core.js';
import {walletScript,type WalletCoin,type WalletKey} from '../src/transactions-core.js';
import {rpc} from '../src/rpc.js';

function extendOnCalls(provider:RegtestElectrum,callsToMine:number[]){
 let calls=0;const read=ElectrumCore.prototype.tip;
 provider.tip=async function(this:RegtestElectrum){
  calls++;
  if(callsToMine.includes(calls)){await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);this.headerCache.clear();await this.refresh();return read.call(this);}
  return read.call(this);
 };
}

async function unconfirmedCoin(provider:RegtestElectrum){
 const address=await rpc<string>('getnewaddress'),info=await rpc<{pubkey:string}>('getaddressinfo',[address]);
 const txid=await rpc<string>('sendtoaddress',[address,0.2]);
 await provider.refresh();
 const tx=provider.rows.get(txid)!.tx,vout=tx.vout.findIndex((output:{scriptPubKey:{hex:string}})=>output.scriptPubKey.hex===walletScript(info.pubkey));
 assert.ok(vout>=0, 'wallet output uses the derived p2pkh script');
 return {key:{path:'receive',index:0,publicKey:info.pubkey} satisfies WalletKey,coin:utxo(tx,vout)};
}

test('BCHN 29.2: repeated block arrivals restart verification and publish only the fresh tip',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const {coin}=await unconfirmedCoin(provider),start=await rpc<{blocks:number}>('getblockchaininfo');
 extendOnCalls(provider,[2,4]);
 const messages:string[]=[],broadcasts:string[]=[];
 provider.sendRawTransaction=async()=>{broadcasts.push('sent');throw Error('verification must not broadcast');};
 const verified=await verifyCoinsAcrossPeers(provider,[coin],true,message=>messages.push(message));
 assert.deepEqual(messages,[BLOCKCHAIN_REFRESH,BLOCKCHAIN_REFRESH]);
 assert.ok(verified.height>start.blocks);
 assert.equal(verified.hash,(await ElectrumCore.prototype.tip.call(provider)).hash);
 assert.equal(verified.ancestry?.some(([id])=>id===coin.txid),true);
 const live=await provider.getUtxosForLockingBytecode(coin.lockingBytecode!);
 assert.equal(live.find(item=>item.txid===coin.txid&&item.vout===coin.vout)?.satoshis,coin.satoshis);
 assert.deepEqual(broadcasts,[]);
}));

test('BCHN 29.2: verification that never settles does not accept the stale tip',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const {coin}=await unconfirmedCoin(provider);
 extendOnCalls(provider,[2,4,6]);
 const messages:string[]=[];
 await assert.rejects(verifyCoinsAcrossPeers(provider,[coin],true,message=>messages.push(message)),error=>{
  assert.ok(error instanceof Error);
  assert.equal(error.message,BLOCKCHAIN_REFRESH);
  return true;
 });
 assert.deepEqual(messages,[BLOCKCHAIN_REFRESH,BLOCKCHAIN_REFRESH]);
}));

test('BCHN 29.2: staggered provider heights are a normal extension, not a disagreement',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const {coin}=await unconfirmedCoin(provider);
 await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);provider.headerCache.clear();await provider.refresh();
 let lag=true;const read=ElectrumCore.prototype.tip,messages:string[]=[];
 provider.tip=async function(this:RegtestElectrum){const tip=await read.call(this);return lag&&this.endpoint===this.endpoints[1]?await this.header(tip.height-1):tip;};
 const verified=await verifyCoinsAcrossPeers(provider,[coin],true,message=>{messages.push(message);lag=false;});
 const fresh=await read.call(provider);
 assert.deepEqual(messages,[BLOCKCHAIN_REFRESH]);
 assert.equal(verified.height,fresh.height);
 assert.equal(verified.hash,fresh.hash);
}));

test('BCHN 29.2: a reorganization is rejected instead of refreshed into success',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const {coin}=await unconfirmedCoin(provider);
 await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);provider.headerCache.clear();await provider.refresh();
 let phase=0;const read=ElectrumCore.prototype.tip,messages:string[]=[];
 provider.tip=async function(this:RegtestElectrum){
  const tip=await read.call(this);
  if(phase===0){phase=1;return tip;}
  if(phase===1){phase=2;await rpc('invalidateblock',[tip.hash]);await rpc('generatetoaddress',[1,await rpc('getnewaddress')]);this.headerCache.clear();await this.refresh();return read.call(this);}
  return read.call(this);
 };
 await assert.rejects(verifyCoinsAcrossPeers(provider,[coin],true,message=>messages.push(message)),/Tip changed during input verification/);
 assert.deepEqual(messages,[]);
}));

test('BCHN 29.2: an unconfirmed conflicting spend is not retried as a block update',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const mature=(await rpc<{txid:string;vout:number;amount:number;spendable:boolean}[]>('listunspent')).find(item=>item.spendable&&item.amount>1)!;
 const signed=async(amount:number)=>rpc<{hex:string;complete:boolean}>('signrawtransactionwithwallet',[await rpc('createrawtransaction',[[{txid:mature.txid,vout:mature.vout}],[{[await rpc<string>('getnewaddress')]:amount}]])]);
 const first=await signed(Number((mature.amount-0.0001).toFixed(8))),second=await signed(Number((mature.amount-0.0002).toFixed(8)));
 assert.equal(first.complete&&second.complete,true);
 const txid=await rpc<string>('sendrawtransaction',[first.hex]);
 provider.extra.set(decodeRawTransaction(second.hex).txid,second.hex);await provider.refresh();
 const coin=utxo(provider.rows.get(txid)!.tx,0),messages:string[]=[];
 await assert.rejects(verifyCoinsAcrossPeers(provider,[coin],true,message=>messages.push(message)),/double-spend|Conflicting unconfirmed ancestry|Input spent/);
 assert.deepEqual(messages,[]);
}));

test('BCHN 29.2: funding discovery restarts one batch after a block and returns the coin once',async()=>isolatedRegtest(async()=>{
 const provider=new RegtestElectrum(0);await provider.refresh();
 const {key,coin}=await unconfirmedCoin(provider);
 extendOnCalls(provider,[2]);
 const messages:string[]=[];
 const found=await discoverFunding(provider,[key],(rows:WalletCoin[])=>rows.some(item=>item.utxo.txid===coin.txid),message=>messages.push(message));
 assert.ok(messages.includes(BLOCKCHAIN_REFRESH));
 assert.equal(found.coins.filter(item=>item.utxo.txid===coin.txid&&item.utxo.satoshis===coin.satoshis).length,1);
}));
