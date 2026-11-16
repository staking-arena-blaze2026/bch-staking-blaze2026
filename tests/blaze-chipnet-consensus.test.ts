import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Network} from 'cashscript';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {blockTicks,tickContext,matureCoinbase,matureSequence,finalityLimit,CHIPNET_ACTIVATION_MTP as activation} from '../src/consensus-clock.js';

test('upgraded BCHN differential: activation, maturity, BIP68, nLockTime and time CSV',{timeout:180000},async()=>{
 await isolatedRegtest(async()=>{
  const miner=await rpc<string>('getnewaddress'),destination=await rpc<string>('getnewaddress');
  const p=new RegtestElectrum(0);p.network=Network.CHIPNET as typeof p.network;
  const rows:any[]=[];
  async function clock(){const tip=await p.tip(),context=await tickContext(p,tip),info=await rpc('getblockchaininfo');assert.equal(context.nextBlockTicks,info.blocks_ticks+info.next_target_time);return {...context,height:tip.height,mtp:info.mediantime};}
  async function mine(n:number){await rpc('generatetoaddress',[n,miner]);p.headerCache.clear();}
  async function coinbase(height:number){const b=await rpc('getblock',[await rpc('getblockhash',[height]),2]);return {txid:b.tx[0].txid,vout:0,value:b.tx[0].vout[0].value,height};}
  async function probe(name:string,source:{txid:string;vout:number;value:number},expected:boolean,sequence=0xfffffffe,locktime=0){
   const raw=await rpc('createrawtransaction',[[{txid:source.txid,vout:source.vout,sequence}],{[destination]:Number((source.value-0.0001).toFixed(8))},locktime]);
   const signed=await rpc('signrawtransactionwithwallet',[raw]);assert.equal(signed.complete,true);
   const [result]=await rpc('testmempoolaccept',[[signed.hex]]);rows.push({name,expected,allowed:result.allowed,reason:result['reject-reason']});assert.equal(result.allowed,expected,JSON.stringify(rows.at(-1)));return signed.hex;
  }
  const old=await coinbase(1),crossing=await coinbase(101);
  await probe('legacy coinbase maturity at 100 blocks',old,matureCoinbase(1,await clock()));
  await probe('legacy immature coinbase',crossing,matureCoinbase(101,await clock()));
  const funding=await rpc<string>('sendtoaddress',[destination,0.1]);await mine(1);
  const fundingTx=await rpc('getrawtransaction',[funding,true]),fundingOutput=fundingTx.vout.find((o:any)=>o.scriptPubKey.addresses?.includes(destination)||o.scriptPubKey.address===destination),source={txid:funding,vout:fundingOutput.n,value:fundingOutput.value,height:102};
  // Cross activation using mock time only inside this disposable node.
  await rpc('setmocktime',[activation+100]);await mine(12);
  let c=await clock();assert.ok(c.activationHeight!==undefined);assert.equal((await rpc('getblockchaininfo')).next_target_time,60);
  const post=await coinbase(c.height);
  await probe('boundary-spanning coinbase still immature',crossing,matureCoinbase(101,c));
  for(const units of [1,2,10])await probe('BIP68 across activation '+units,source,matureSequence(source.height,units,c),units);
  for(const lock of [Math.floor(finalityLimit(c))-1,Math.ceil(finalityLimit(c))])await probe('height nLockTime '+lock,source,lock<finalityLimit(c),0xfffffffe,lock);
  await probe('all-final sequences bypass nLockTime',source,true,0xffffffff,499999999);
  await probe('time nLockTime strict cutoff',source,false,0xfffffffe,c.mtp);
  await probe('time nLockTime before cutoff',source,true,0xfffffffe,c.mtp-1);
  const timeAnchor=(await rpc('getblockheader',[await rpc('getblockhash',[source.height-1])])).mediantime;
  await probe('time CSV remains 512 seconds',source,c.mtp>=timeAnchor+512,0x400001);
  const pending=await rpc<string>('sendtoaddress',[destination,0.12]),pendingTx=await rpc('getrawtransaction',[pending,true]),out=pendingTx.vout.find((o:any)=>o.scriptPubKey.addresses?.includes(destination)||o.scriptPubKey.address===destination),unconfirmed={txid:pending,vout:out.n,value:out.value};
  await probe('zero-conf sequence zero',unconfirmed,true,0);
  await probe('zero-conf positive sequence',unconfirmed,false,1);
  await mine(1);c=await clock();const confirmedHeight=c.height;
  await probe('post-upgrade BIP68 before ten blocks',unconfirmed,matureSequence(confirmedHeight,1,c),1);
  const anchor=(await rpc('getblockheader',[await rpc('getblockhash',[confirmedHeight-1])])).mediantime;
  await probe('post-upgrade time CSV before 512 seconds',unconfirmed,c.mtp>=anchor+512,0x400001);
  await mine(8);c=await clock();
  await probe('post-upgrade BIP68 at nine blocks',unconfirmed,false,1);
  await mine(1);c=await clock();
  await probe('post-upgrade BIP68 at ten blocks',unconfirmed,true,1);
  await rpc('setmocktime',[activation+1000]);await mine(6);c=await clock();
  await probe('post-upgrade time CSV after 512 seconds',unconfirmed,c.mtp>=anchor+512,0x400001);
  // A post-upgrade source needs 1000 actual blocks, including the candidate.
  await mine(post.height+998-(await rpc<number>('getblockcount')));c=await clock();assert.equal(matureCoinbase(post.height,c),false);
  await probe('post-upgrade coinbase at 999 blocks',post,false);
  await mine(1);c=await clock();assert.equal(matureCoinbase(post.height,c),true);
  await probe('post-upgrade coinbase at 1000 blocks',post,true);
  await probe('boundary-spanning coinbase now mature',crossing,matureCoinbase(crossing.height,c));
  assert.equal(blockTicks(c.height,c.activationHeight),(await rpc('getblockchaininfo')).blocks_ticks);
  await writeFile('docs/blaze2026/chipnet-upgrade/consensus-compatibility.json',JSON.stringify({at:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,activationHeight:c.activationHeight,scope:'Fresh isolated regtest, real upgraded BCHN testmempoolaccept; no public transactions or original node changes',rows},null,2)+'\n');
 },18458,[`-mocktime=${activation-1000}`,`-upgrade2027activationtime=${activation}`]);
});
