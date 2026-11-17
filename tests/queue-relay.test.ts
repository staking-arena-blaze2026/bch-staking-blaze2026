import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {SignatureTemplate,TransactionBuilder,type SpendableUtxo} from 'cashscript';
import {binToHex,hexToBin,hashTransaction,encodeTransaction,type Transaction} from '@bitauth/libauth';
import {isolatedRegtest} from './fixtures/isolated-regtest.js';
import {queueRelayPeer} from './fixtures/queue-relay-peer.js';
import {RegtestElectrum} from './fixtures/regtest-electrum.js';
import {rpc} from '../src/rpc.js';
import {utxo} from '../src/arena-core.js';
import {create,insert,remove,withdraw,genesis,node,gate,ownerScript,verify,ZERO,CARRIER,type Parameters,type Funding} from '../src/queue/protocol.js';
import {ownerAddress} from '../src/v3/protocol.js';

test('queue: isolated activated BCHN standard-policy relay lifecycle',{timeout:600000},async()=>isolatedRegtest(async()=>{
 const p=new RegtestElectrum(await rpc('getblockcount')),key=new SignatureTemplate(new Uint8Array(32).fill(17)),owner=ownerAddress(key.publicKey,p),miner=await rpc<string>('getnewaddress');
 const relay=await queueRelayPeer();try{
 const rows:unknown[]=[];let mocked=0;
 async function setClock(time:number){mocked=time;await rpc('setmocktime',[time]);await relay.peer('setmocktime',[time]);}
 async function fund(to=owner,amount=0.03):Promise<SpendableUtxo>{const raw=await rpc('createrawtransaction',[[],{[to]:amount}]),funded=await rpc('fundrawtransaction',[raw,{changePosition:1}]),signed=await rpc('signrawtransactionwithwallet',[funded.hex]),id=await rpc<string>('sendrawtransaction',[signed.hex]);await p.refresh();return utxo(await p.transactionStatus(id),0);}
 const funding=async():Promise<Funding>=>({input:await fund(),unlocker:key.unlockP2PKH()});
 async function reject(label:string,plan:ReturnType<typeof insert>|ReturnType<typeof create>|ReturnType<typeof remove>,mutate:()=>void){const saved=structuredClone(plan.builder.outputs),inputs=plan.builder.inputs.map(i=>({...i}));try{mutate();plan.builder.outputs.at(-1)!.amount-=10000n;const tx=(plan.builder as unknown as {buildLibauthTransaction:(skip:boolean)=>Transaction}).buildLibauthTransaction(true),raw=binToHex(encodeTransaction(tx));const [result]=await rpc('testmempoolaccept',[[raw]]);rows.push({label,expected:'rejected',allowed:result.allowed,reason:result['reject-reason']});assert.equal(result.allowed,false,label);assert.match(result['reject-reason'],/script|token/i,label+' must fail authorization, not fee or value policy');}finally{plan.builder.outputs=saved;plan.builder.inputs=inputs;}}
 async function submit(label:string,plan:{raw:string;fee:bigint;bytes:number;sources:SpendableUtxo[]}){verify(plan);await relay.until(async()=>await relay.peer('getbestblockhash')===await rpc('getbestblockhash'),'current chain');const [accept]=await rpc('testmempoolaccept',[[plan.raw]]);const row={label,bytes:plan.bytes,fee:Number(plan.fee),allowed:accept.allowed,reason:accept['reject-reason'],p2pRelayed:false};rows.push(row);assert.equal(accept.allowed,true,JSON.stringify(accept));const id=await rpc<string>('sendrawtransaction',[plan.raw]);try{await relay.until(async()=>{if((await relay.peer('getrawmempool')).includes(id))return true;if(mocked)await setClock(mocked+2);return false;},'transaction '+label);}catch(e){throw Error(String(e)+'; receiving peer admission '+JSON.stringify(await relay.peer('testmempoolaccept',[[plan.raw]])));}row.p2pRelayed=true;await p.refresh();const tx=await p.transactionStatus(id);return tx.vout.map((_:unknown,i:number)=>utxo(tx,i));}
 const params:Parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:(await rpc('getblockchaininfo')).mediantime-10000,interval:60,releases:20,cap:2000n};
 const seed=await fund(genesis(params,key.publicKey,p).address),created=create(params,seed,await funding(),[],key,p),c=created.context;
 await reject('genesis extra minting authority',created,()=>{created.builder.outputs.at(-1)!.token=structuredClone(created.builder.outputs[1]!.token!);});
 await reject('genesis minting vault',created,()=>{created.builder.outputs[0]!.token!.nft!.capability='minting';});
 const [v,r]=await submit('create',created);
 const first=insert(c,v!,r!,{stake:10000n,duration:512,reward:2000n},key,[await funding()]);
 await reject('unbacked BCH node',first,()=>{first.builder.outputs[2]!.amount--;first.builder.outputs.at(-1)!.amount++;});
 await reject('unauthorized node id',first,()=>{first.builder.outputs[2]!.token!.nft!.commitment='ff'.repeat(32)+first.builder.outputs[2]!.token!.nft!.commitment.slice(64);});
 await reject('minting authority leaked into change',first,()=>{first.builder.outputs.at(-1)!.token=structuredClone(first.builder.outputs[2]!.token!);});
 await reject('root destruction',first,()=>{first.builder.outputs[1]!.token=undefined;});
 await reject('wrong vault pointer',first,()=>{first.builder.outputs[0]!.token!.nft!.commitment=v!.token!.nft!.commitment;});
 const [v1,r1,a]=await submit('empty insertion',first);
 const second=insert(c,a!,undefined,{stake:9000n,duration:512,reward:2000n},key,[await funding()]);
 const [a1,b]=await submit('ordinary insertion',second);
 const highest=insert(c,v1!,a1!,{stake:20000n,duration:512,reward:2000n},key,[await funding()]);
 const [v2,a2,h]=await submit('highest insertion',highest);
 const cancel=remove(c,a2!,b!,1,await funding(),key);
 await reject('unauthorized cancellation signature',cancel,()=>{cancel.builder.inputs[0]!.unlocker=node(c).unlock.transition(1n,new Uint8Array(),new SignatureTemplate(new Uint8Array(32).fill(18)));});
 await reject('cancellation fee extraction',cancel,()=>{cancel.builder.outputs[1]!.amount--;cancel.builder.outputs.at(-1)!.amount++;});
 await reject('incorrect predecessor relink',cancel,()=>{cancel.builder.outputs[0]!.token!.nft!.commitment=a2!.token!.nft!.commitment;});
 const [a3]=await submit('ordinary cancellation',cancel);
 const claimed=remove(c,v2!,h!,2,await funding(),undefined,undefined,undefined,params.epoch+params.interval*20+1);
 await reject('fake head claim',claimed,()=>{Object.assign(claimed.builder.inputs[1]!,a3);});
 await reject('reward fee extraction',claimed,()=>{claimed.builder.outputs[1]!.amount--;claimed.builder.outputs.at(-1)!.amount++;});
 await reject('unlocked allocation substitution',claimed,()=>{claimed.builder.outputs[2]!.to=ownerScript(key.publicKey);});
 const [v3, , locked]=await submit('head claim',claimed);
 const withdrawal=withdraw(c,highest.offer,locked!,key,await funding());
 const [early]=await rpc('testmempoolaccept',[[withdrawal.raw]]);assert.equal(early.allowed,false);
 await rpc('generatetoaddress',[1,miner]);
 const clock=(await rpc('getblockchaininfo')).mediantime;
 await setClock(clock+1200);await rpc('generatetoaddress',[12,miner]);
 await submit('matured withdrawal',withdrawal);
 const [empty]=await submit('head cancellation to empty',remove(c,v3!,a3!,1,await funding(),key));
 const reset=insert(c,empty!,r1!,{stake:10000n,duration:512,reward:100000n},key,[await funding()]),[v4,r2,unfundable]=await submit('empty reinitialization using persistent root',reset);
 const [v5]=await submit('return permanently unfundable head',remove(c,v4!,unfundable!,3,await funding()));
 // Separate predecessor UTXOs permit independent insertions; the same predecessor conflicts.
 const aa=insert(c,v5!,r2!,{stake:10000n,duration:512,reward:2000n},key,[await funding()]),[vv,,aa0]=await submit('concurrency: first node',aa);
 const bb=insert(c,aa0!,undefined,{stake:8000n,duration:512,reward:2000n},key,[await funding()]),[aa1,bb0]=await submit('concurrency: second node',bb);
 const dd=insert(c,bb0!,undefined,{stake:5000n,duration:512,reward:2000n},key,[await funding()]),[bb1,dd0]=await submit('concurrency: third node',dd);
 const left=insert(c,aa1!,undefined,{stake:9000n,duration:512,reward:2000n},key,[await funding()]);
 const conflict=insert(c,aa1!,undefined,{stake:9500n,duration:512,reward:2000n},key,[await funding()]);
 const right=insert(c,dd0!,undefined,{stake:4000n,duration:512,reward:2000n},key,[await funding()]);
 assert.equal(left.sources.some(l=>right.sources.some(r=>l.txid===r.txid&&l.vout===r.vout)),false);
 await submit('concurrency: left insertion',left);await submit('concurrency: independent right insertion',right);
 await submit('equal score follows previous registration',insert(c,bb1!,undefined,{stake:8000n,duration:512,reward:2000n},key,[await funding()]));
 const [conflicted]=await rpc('testmempoolaccept',[[conflict.raw]]);assert.equal(conflicted.allowed,false);rows.push({label:'concurrency: same predecessor conflict',allowed:conflicted.allowed,reason:conflicted['reject-reason']});
 // Worst-case 75-bit score products under the activated BigInt rules.
 const maxParams={...params,releases:1000,cap:1000000n},maxSeed=await fund(genesis(maxParams,key.publicKey,p).address,20),maxCreated=create(maxParams,maxSeed,await funding(),[],key,p),mc=maxCreated.context;
 const [mv,mr]=await submit('maximum operands: genesis',maxCreated);
 const maxFirst=insert(mc,mv!,mr!,{stake:1000000n,duration:33553920,reward:1200n},key,[await funding()]),[,,mn]=await submit('maximum operands: highest score',maxFirst);
 await submit('maximum operands: 75-bit comparison',insert(mc,mn!,undefined,{stake:1000000n,duration:33553920,reward:1000000000n},key,[await funding()]));

 // Real token genesis, all asset combinations including equal token categories.
 async function token(){const seed=await fund(),b=new TransactionBuilder({provider:p}).addInput(seed,key.unlockP2PKH()).addOutput({to:owner,amount:seed.satoshis-1000n,token:{category:seed.txid,amount:1000000n}});const raw=b.build(),id=await rpc<string>('sendrawtransaction',[raw]);await p.refresh();return utxo(await p.transactionStatus(id),0);}
 const tokenA=await token(),tokenB=await token();let tokenCounter=0;
 for(const [stakeCat,rewardCat]of [[ZERO,tokenA.token!.category],[tokenA.token!.category,ZERO],[tokenA.token!.category,tokenB.token!.category],[tokenA.token!.category,tokenA.token!.category]]){
  const assetParams={...params,stakingCategory:stakeCat!,rewardCategory:rewardCat!};
  async function exactToken(category:string,amount:bigint){let input=category===tokenA.token!.category?tokenA:tokenB;const b=new TransactionBuilder({provider:p}).addInput(input,key.unlockP2PKH()).addOutput({to:owner,amount:1200n,token:{category,amount}}).addOutput({to:owner,amount:input.satoshis-2200n,token:{category,amount:input.token!.amount-amount}});const id=await rpc<string>('sendrawtransaction',[b.build()]);await p.refresh();const tx=await p.transactionStatus(id),change=utxo(tx,1);Object.assign(input,change);return {input:utxo(tx,0),unlocker:key.unlockP2PKH()};}
  const rewardFunds=rewardCat===ZERO?[]:[await exactToken(rewardCat!,40000n)];
  const prep=await fund(genesis(assetParams,key.publicKey,p).address),creation=create(assetParams,prep,await funding(),rewardFunds,key,p),ctx=creation.context;
  const [v,r,res]=await submit(`tokens ${++tokenCounter}: create`,creation);
  const funds=stakeCat===ZERO?[await funding()]:[await exactToken(stakeCat!,10000n),await funding()];
  const reg=insert(ctx,v!,r!,{stake:10000n,duration:512,reward:2000n},key,funds);
  if(stakeCat!==ZERO)await reject('escrow token mismatch',reg,()=>{reg.builder.outputs[3]!.token!.amount--;reg.builder.outputs[3]!.token!.amount--;});
  const [v1,,offer,esc]=await submit(`tokens ${tokenCounter}: empty insertion`,reg);
  async function rejectBuilt(label:string,plan:{raw:string}){const [result]=await rpc('testmempoolaccept',[[plan.raw]]);rows.push({label,expected:'rejected',allowed:result.allowed,reason:result['reject-reason']});assert.equal(result.allowed,false);assert.match(result['reject-reason'],/script|token/i);}
  if(stakeCat!==ZERO)await rejectBuilt('insertion cannot consume head token escrow',insert(ctx,v1!,offer!,{stake:10000n,duration:1024,reward:2000n},key,[{input:esc!,unlocker:gate(ctx,reg.offer.id).unlock.release()},await funding()]));
  if(stakeCat===rewardCat&&stakeCat!==ZERO)await rejectBuilt('insertion cannot consume reward reserve',insert(ctx,v1!,offer!,{stake:20000n,duration:1024,reward:2000n},key,[{input:res!,unlocker:gate(ctx).unlock.release()},await funding()]));
  const claim=remove(ctx,v1!,offer!,2,await funding(),undefined,stakeCat!==ZERO?esc:undefined,rewardCat!==ZERO?res:undefined,params.epoch+params.interval*20+1);
  if(rewardCat!==ZERO)await reject('reward reserve token theft',claim,()=>{claim.builder.outputs[3]!.token!.amount--;claim.builder.outputs[1]!.token!.amount++;});
  const [,,allocation]=await submit(`tokens ${tokenCounter}: head claim`,claim);
  const withdrawPlan=withdraw(ctx,reg.offer,allocation!,key,await funding());
  await rpc('generatetoaddress',[1,miner]);const now=(await rpc('getblockchaininfo')).mediantime;await setClock(now+1200);await rpc('generatetoaddress',[12,miner]);
  await submit(`tokens ${tokenCounter}: withdrawal`,withdrawPlan);
 }
 await mkdir('docs/blaze2026/linked-queue',{recursive:true});await writeFile('docs/blaze2026/linked-queue/relay-results.json',JSON.stringify({at:new Date().toISOString(),node:(await rpc('getnetworkinfo')).subversion,chain:await rpc('getblockchaininfo'),rows},null,2)+'\n');
 }finally{await relay.close();}
},18468,['-expire=0','-upgrade12activationheight=1']));
