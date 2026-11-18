import test from 'node:test';
import assert from 'node:assert/strict';
import {MockNetworkProvider,Network,SignatureTemplate,type SpendableUtxo} from 'cashscript';
import {binToHex,hexToBin,hashTransaction,encodeTransaction,type Transaction} from '@bitauth/libauth';
import {create,insert,remove,withdraw,arena,node,gate,ownerScript,verify,ZERO,decodeOffer,readState,rewardStatus,type Parameters,type Funding,type Context} from '../src/queue/protocol.js';
import {snapshot,insertionPoint,cancellationPoint,authenticateGenesis} from '../src/queue/indexer.js';
import {acceptSigned,submit,refreshCancellation,type Operation} from '../src/queue/recovery.js';
const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
const alice=new SignatureTemplate(new Uint8Array(32).fill(7)),bob=new SignatureTemplate(new Uint8Array(32).fill(8));
let serial=0;
const coin=(n=10000000n,key=alice):Funding=>({input:{txid:(++serial).toString(16).padStart(64,'0'),vout:0,satoshis:n,lockingBytecode:binToHex(ownerScript(key.publicKey))},unlocker:key.unlockP2PKH()});
function outputs(plan:{raw:string;sources:SpendableUtxo[]}){const tx=verify(plan),id=hashTransaction(hexToBin(plan.raw));return tx.outputs.map((o,vout)=>({txid:id,vout,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount,...(o.token.nft?{nft:{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})}));}
test('queue: signed genesis, empty/highest/ordinary insertion, cancellation and head claim',()=>{
 const p:Parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:1800000000,interval:60,releases:1000,cap:2000n};
 const seed=coin();
 const created=create(p,seed,coin(),[],alice,provider),c=created.context;
 const [vault,root]=outputs(created);
 const first=insert(c,vault!,root!,{stake:10000n,duration:512,reward:2000n},alice,[coin()]);
 const [v1,r1,a1]=outputs(first);
 const second=insert(c,a1!,undefined,{stake:9000n,duration:512,reward:2000n},bob,[coin(100000n,bob)]);
 const [a2,b1]=outputs(second);
 const high=insert(c,v1!,a2!,{stake:20000n,duration:512,reward:2000n},bob,[coin(100000n,bob)]);
 const [v2,a3,h1]=outputs(high);
 const cancelled=remove(c,a3!,b1!,1,coin(),bob);outputs(cancelled);
 const claimed=remove(c,v2!,h1!,2,coin(),undefined,undefined,undefined,1800000061);outputs(claimed);
 outputs(remove(c,v2!,h1!,2,[coin(3000n),coin(4000n)],undefined,undefined,undefined,1800000061));
 assert.equal(r1!.token!.nft!.commitment,'00');
 console.log({create:created.bytes,empty:first.bytes,ordinary:second.bytes,highest:high.bytes,cancel:cancelled.bytes,claim:claimed.bytes});
});

const p:Parameters={stakingCategory:ZERO,rewardCategory:ZERO,epoch:1800000000,interval:60,releases:2,cap:2000n};
function setup(params=p){const seed=coin(),q=coin(),fund:Funding[]=[];if(params.rewardCategory!==ZERO)fund.push({...coin(),input:{...coin().input,token:{category:params.rewardCategory,amount:4000n}}});const created=create(params,seed,q,fund,alice,provider),[vault,root]=outputs(created);return {created,c:created.context,vault:vault!,root:root!,seed,q,fund};}
function rejection(plan:ReturnType<typeof insert>|ReturnType<typeof remove>|ReturnType<typeof create>,mutate:()=>void){
 const saved=structuredClone(plan.builder.outputs),inputs=plan.builder.inputs.map(i=>({...i,...(i.token?{token:structuredClone(i.token)}:{})}));try{mutate();const tx=(plan.builder as unknown as {buildLibauthTransaction:(skip:boolean)=>Transaction}).buildLibauthTransaction(true);const raw=binToHex(encodeTransaction(tx));assert.throws(()=>'context' in plan?authenticateGenesis(plan.context,{genesis:hashTransaction(hexToBin(raw)),creator:binToHex(alice.publicKey)},raw,plan.sources):verify({raw,sources:plan.sources}));}finally{plan.builder.outputs=saved;plan.builder.inputs=inputs;}
}
test('queue: every BCH/token asset combination, independent escrow and independent withdrawal',()=>{
 for(const [stake,reward]of [[ZERO,ZERO],[ZERO,'aa'.repeat(32)],['bb'.repeat(32),ZERO],['bb'.repeat(32),'aa'.repeat(32)],['bb'.repeat(32),'bb'.repeat(32)]]){
  const {created,c:c2,vault:v2,root:r2}=setup({...p,stakingCategory:stake!,rewardCategory:reward!});
  const funding=coin();if(stake!==ZERO)funding.input.token={category:stake!,amount:20000n};
  const reg=insert(c2,v2,r2,{stake:10000n,duration:512,reward:2000n},alice,[funding]),[s2,,o2,e2]=outputs(reg);
  const rewardInput=reward!==ZERO?outputs(created)[2]:undefined;
  const claim=remove(c2,s2!,o2!,2,coin(),undefined,stake!==ZERO?e2:undefined,rewardInput,1800000121),claimed=outputs(claim);
  const withdrawal=withdraw(c2,reg.offer,claimed[2]!,alice,coin());outputs(withdrawal);
  assert.throws(()=>verify(withdraw(c2,reg.offer,claimed[2]!,bob,coin(100000n,bob))));
  rejection(withdrawal,()=>{withdrawal.builder.outputs[0]!.amount--;withdrawal.builder.outputs.at(-1)!.amount++;});
  assert.throws(()=>verify(remove(c2,s2!,o2!,2,coin(),undefined,stake!==ZERO?e2:undefined,rewardInput,1800000000)));
  outputs(remove(c2,s2!,o2!,1,coin(),alice,stake!==ZERO?e2:undefined));
  if(stake!==ZERO)rejection(claim,()=>{claim.builder.inputs[2]!.token!.amount--;});
 }
});
test('queue: malicious minting, identities, ownership, links, protected amounts and fees',()=>{
 const {created,c,vault,root,seed,q,fund}=setup();
 authenticateGenesis(c,{genesis:hashTransaction(hexToBin(created.raw)),creator:binToHex(alice.publicKey)},created.raw,created.sources);
 assert.throws(()=>authenticateGenesis({...c,identity:{...c.identity,queue:ZERO}},{genesis:hashTransaction(hexToBin(created.raw)),creator:binToHex(alice.publicKey)},created.raw,created.sources));
 const first=insert(c,vault,root,{stake:10000n,duration:512,reward:2000n},alice,[coin()]),[v,r,a]=outputs(first);
 rejection(first,()=>{first.builder.inputs[0]!.unlocker=arena(c).unlock.transition(0n,Buffer.concat([Buffer.from(alice.publicKey),Buffer.from('1027000000020000d0070000','hex')]),bob);});
 rejection(created,()=>{created.builder.outputs[0]!.token!.nft!.capability='minting';});
 rejection(created,()=>{created.builder.outputs.at(-1)!.token={...created.builder.outputs[1]!.token!};});
 rejection(created,()=>{created.builder.outputs[0]!.token!.nft!.commitment='00'.repeat(48);});
 rejection(first,()=>{first.builder.outputs[2]!.token!.nft!.capability='mutable';});
 rejection(first,()=>{first.builder.outputs[2]!.token!.amount=1n;});
 rejection(first,()=>{first.builder.outputs[2]!.token!.nft!.commitment='ff'.repeat(32)+first.builder.outputs[2]!.token!.nft!.commitment.slice(64);});
 rejection(first,()=>{first.builder.outputs[2]!.amount--;first.builder.outputs.at(-1)!.amount++;});
 rejection(first,()=>{first.builder.outputs[0]!.amount--;first.builder.outputs.at(-1)!.amount++;});
 rejection(first,()=>{first.builder.outputs.at(-1)!.token=structuredClone(first.builder.outputs[2]!.token!);});
 rejection(first,()=>{first.builder.outputs[2]!.to=ownerScript(bob.publicKey);});
 rejection(first,()=>{first.builder.outputs[1]!.token!.nft!.commitment='01';});
 rejection(first,()=>{first.builder.outputs[0]!.token!.nft!.commitment=created.builder.outputs[0]!.token!.nft!.commitment;});
 const second=insert(c,a!,undefined,{stake:9000n,duration:512,reward:2000n},bob,[coin(100000n,bob)]),[a1,b]=outputs(second);
 const cancel=remove(c,a1!,b!,1,coin(),bob);
 rejection(cancel,()=>{cancel.builder.inputs[0]!.unlocker=node(c).unlock.transition(1n,new Uint8Array(),alice);});
 rejection(cancel,()=>{cancel.builder.outputs[1]!.amount--;cancel.builder.outputs.at(-1)!.amount++;});
 rejection(cancel,()=>{cancel.builder.outputs[0]!.token!.nft!.commitment=a1!.token!.nft!.commitment;});
 rejection(cancel,()=>{cancel.builder.outputs[1]!.to=ownerScript(alice.publicKey);});
 assert.throws(()=>remove(c,a1!,b!,1,coin(),alice),/owner/);
 const claim=remove(c,v!,a1!,2,coin(),undefined,undefined,undefined,1800000061);
 rejection(claim,()=>{claim.builder.outputs[1]!.amount--;claim.builder.outputs.at(-1)!.amount++;});
 rejection(claim,()=>{claim.builder.outputs[2]!.to=ownerScript(bob.publicKey);});
 rejection(claim,()=>{claim.builder.outputs[0]!.token!.nft!.commitment='00'.repeat(44)+'a00f0000';});
 assert.throws(()=>remove(c,v!,b!,2,coin(),undefined,undefined,undefined,1800000061),/authenticated successor/);
 assert.throws(()=>outputs(remove(c,v!,a1!,3,coin())),/Error/);
 assert.throws(()=>outputs(remove(c,v!,a1!,2,coin(),undefined,undefined,undefined,1800000001)));
 assert.throws(()=>insert(c,a1!,undefined,{stake:1000000n,duration:512,reward:1200n},alice,[coin()]));
 assert.throws(()=>insert(c,a1!,undefined,{stake:8000n,duration:513,reward:2000n},alice,[coin()]),/duration/);
 assert.throws(()=>insert(c,v!,r!,{stake:20000n,duration:512,reward:2000n},alice,[coin()]).builder.build()&&verify(insert(c,v!,r!,{stake:20000n,duration:512,reward:2000n},alice,[coin()])));
});
test('queue: equal scores, independent insertion positions, stable-id recovery and reserve states',async()=>{
 const {c,vault,root}=setup();
 const first=insert(c,vault,root,{stake:10000n,duration:512,reward:2000n},alice,[coin()]),[v,r,a]=outputs(first);
 const equal=insert(c,a!,undefined,{stake:10000n,duration:512,reward:2000n},bob,[coin(100000n,bob)]),[a1,b]=outputs(equal);
 const tail=insert(c,b!,undefined,{stake:5000n,duration:512,reward:2000n},alice,[coin()]),[b1,d]=outputs(tail);

 // Equal predecessor/successor scores have no insertion interval; ties follow b.
 assert.throws(()=>insert(c,a1!,undefined,{stake:15000n,duration:512,reward:3000n},alice,[coin()]));
 assert.throws(()=>insert(c,a1!,undefined,{stake:10000n,duration:512,reward:2000n},alice,[coin()]));
 const s=snapshot(c,[v!,r!,a1!,b1!,d!]);assert.deepEqual(s.ordered.map(o=>o.id),[first.offer.id,equal.offer.id,tail.offer.id]);
 assert.equal(insertionPoint(s,{stake:10000n,duration:512,reward:2000n}).controller.txid,b1!.txid);
 assert.equal(cancellationPoint(s,equal.offer.id).controller.txid,a1!.txid);
 assert.throws(()=>snapshot(c,[v!,r!,a1!,b1!,d!,{...b1!,vout:100}]));
 const op:Operation={id:'cancel',kind:'cancel',offerId:equal.offer.id,status:'review',sources:[]};assert.equal(refreshCancellation(op,s).node.txid,b1!.txid);
 const signed={...op,raw:equal.raw,sources:equal.sources};assert.throws(()=>refreshCancellation(signed,s));
 const saved:Operation[]=[];await assert.rejects(()=>submit(signed,{save:async o=>{saved.push(o);}},async()=>{throw Error('lost acknowledgement');}));assert.equal(saved[0]!.raw,equal.raw);
 assert.equal(acceptSigned(equal.raw,equal.raw,equal.sources),hashTransaction(hexToBin(equal.raw)));
 assert.throws(()=>acceptSigned(equal.raw,tail.raw,equal.sources));
 const vs=readState(c,v!);assert.equal(rewardStatus(c.p,vs,2000n,1800000001),'awaiting-release');assert.equal(rewardStatus(c.p,vs,2000n,1800000061),'available');assert.equal(rewardStatus(c.p,vs,5000n,1800000121),'never-funded');
 const independentLeft=insert(c,b1!,undefined,{stake:9000n,duration:512,reward:2000n},alice,[coin()]),[b2,l]=outputs(independentLeft);
 const independentRight=insert(c,d!,undefined,{stake:4000n,duration:512,reward:2000n},alice,[coin()]),[d2,rr]=outputs(independentRight);
 assert.equal(new Set([...independentLeft.sources,...independentRight.sources].map(u=>u.txid+':'+u.vout)).size,independentLeft.sources.length+independentRight.sources.length);
 assert.equal(snapshot(c,[v!,r!,a1!,b2!,l!,d2!,rr!]).ordered.length,5);
 const impossible=insert(c,d!,undefined,{stake:1200n,duration:512,reward:10000n},alice,[coin()]);outputs(impossible);
});


test('queue: insertion cannot consume a live token escrow or reward reserve',()=>{
 const token='ab'.repeat(32),{created,c,vault,root}=setup({...p,stakingCategory:token,rewardCategory:token});
 const reserve=outputs(created)[2]!;
 const deposit=coin();deposit.input.token={category:token,amount:10000n};
 const first=insert(c,vault,root,{stake:10000n,duration:512,reward:2000n},alice,[deposit]);
 const [v,,head,escrow]=outputs(first);
 const stealEscrow=insert(c,v!,head!,{stake:10000n,duration:1024,reward:2000n},bob,[{input:escrow!,unlocker:gate(c,first.offer.id).unlock.release()},coin(100000n,bob)]);
 assert.throws(()=>verify(stealEscrow),/Script|OP_|failed|unsuccessful/i);
 const stealReserve=insert(c,v!,head!,{stake:4000n,duration:2048,reward:2000n},bob,[{input:reserve,unlocker:gate(c).unlock.release()},coin(100000n,bob)]);
 assert.throws(()=>verify(stealReserve),/Script|OP_|failed|unsuccessful/i);
 // The legitimate highest insertion retains both backed asset gates.
 const funded=coin();funded.input.token={category:token,amount:10000n};
 verify(insert(c,v!,head!,{stake:10000n,duration:1024,reward:2000n},alice,[funded]));
});

test('atomic genesis: consensus-valid forged origins fail authentication',()=>{
 const mutations=[
  (plan:ReturnType<typeof create>)=>{plan.builder.outputs[0]!.token!.nft!.capability='minting';},
  (plan:ReturnType<typeof create>)=>{plan.builder.outputs.at(-1)!.token=structuredClone(plan.builder.outputs[1]!.token!);},
  (plan:ReturnType<typeof create>)=>{plan.builder.outputs[0]!.token!.nft!.commitment='00'.repeat(48);},
  (plan:ReturnType<typeof create>)=>{plan.builder.outputs[0]!.amount--;plan.builder.outputs.at(-1)!.amount++;},
  (plan:ReturnType<typeof create>)=>{plan.builder.outputs[1]!.to=ownerScript(alice.publicKey);},
 ];
 for(const mutate of mutations){const {created,c}=setup();mutate(created);created.builder.outputs.at(-1)!.amount-=1000n;const raw=created.builder.build();verify({raw,sources:created.sources});assert.throws(()=>authenticateGenesis(c,{genesis:hashTransaction(hexToBin(raw)),creator:binToHex(alice.publicKey)},raw,created.sources));}
 const {created,c}=setup({...p,rewardCategory:'ab'.repeat(32)});created.builder.outputs[2]!.token!.amount--;created.builder.outputs.at(-1)!.token={category:c.p.rewardCategory,amount:1n};created.builder.outputs.at(-1)!.amount-=1000n;const raw=created.builder.build();verify({raw,sources:created.sources});assert.throws(()=>authenticateGenesis(c,{genesis:hashTransaction(hexToBin(raw)),creator:binToHex(alice.publicKey)},raw,created.sources),/reserve/);
});
test('atomic genesis rejects ineligible, duplicate or shared-category inputs',()=>{
 const a=coin(),b=coin();assert.throws(()=>create(p,{...a,input:{...a.input,vout:1}},b,[],alice,provider),/output-zero/);
 assert.throws(()=>create(p,a,a,[],alice,provider),/distinct/);
 assert.throws(()=>create(p,a,b,[a],alice,provider),/funding/);
 assert.throws(()=>arena({p,identity:{vault:a.input.txid,queue:a.input.txid},provider}),/collision/);
});
