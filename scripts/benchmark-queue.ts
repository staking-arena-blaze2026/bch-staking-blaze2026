/** Deterministic signed-byte comparison. Relay evidence is a separate native test. */
import {writeFile,mkdir} from 'node:fs/promises';
import {MockNetworkProvider,Network,SignatureTemplate,type SpendableUtxo,type TransactionBuilder} from 'cashscript';
import {binToHex,hexToBin,decodeTransaction,hashTransaction,createVirtualMachineBch2026} from '@bitauth/libauth';
import * as q from '../src/queue/protocol.js';
import * as v from '../src/v3/protocol.js';
import {snapshot} from '../src/queue/indexer.js';
const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
const signer=new SignatureTemplate(new Uint8Array(32).fill(53)),owner={publicKey:binToHex(signer.publicKey),path:'receive' as const,index:0};
let serial=0;const coin=(satoshis=3000000n,token?:SpendableUtxo['token']):SpendableUtxo=>({txid:(++serial).toString(16).padStart(64,'0'),vout:0,satoshis,lockingBytecode:binToHex(q.ownerScript(signer.publicKey)),...(token?{token}:{})});
const fund=(input=coin())=>({input,unlocker:signer.unlockP2PKH()});
function outputs(raw:string){const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error(tx);return tx.outputs.map((o,vout):SpendableUtxo=>({txid:hashTransaction(hexToBin(raw)),vout,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount,...(o.token.nft?{nft:{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})}));}
function measure(builder:TransactionBuilder,sources:SpendableUtxo[]){const raw=builder.build(),tx=q.verify({raw,sources}),sourceOutputs=sources.map(q.source),vm=createVirtualMachineBch2026();return {bytes:raw.length/2,fee:Number(sources.reduce((n,u)=>n+u.satoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n)),inputs:tx.inputs.length,outputs:tx.outputs.length,resources:tx.inputs.map((_,inputIndex)=>{const m=vm.evaluate({inputIndex,sourceOutputs,transaction:tx}).metrics;return {unlockingBytes:tx.inputs[inputIndex]!.unlockingBytecode.length,operationCost:m.operationCost,maximumOperationCost:m.maximumOperationCost,hashIterations:m.hashDigestIterations,maximumHashIterations:m.maximumHashDigestIterations};})};}
const rows=[];
for(const [stake,reward]of [[q.ZERO,q.ZERO],[q.ZERO,'aa'.repeat(32)],['bb'.repeat(32),q.ZERO],['bb'.repeat(32),'aa'.repeat(32)],['bb'.repeat(32),'bb'.repeat(32)]]){
 const oldParams:v.Parameters={version:3,registryVersion:4,stakingAsset:stake===q.ZERO?{kind:'bch'}:{kind:'token',category:stake!},rewardAsset:reward===q.ZERO?{kind:'bch'}:{kind:'token',category:reward!},epoch:1800000000,periodSeconds:60,periods:20,cap:2000n};
 const clock={height:1000,mtp:1800002000},coins=[coin(),...(reward===q.ZERO?[]:[coin(1200n,{category:reward!,amount:40000n})])].map(utxo=>({...owner,utxo}));
 const creation=v.directGenesisBuilder(oldParams,coins,owner,provider);creation.builder.inputs.forEach(i=>{i.unlocker=signer.unlockP2PKH();});
 const initial: v.Instance={parameters:oldParams,category:creation.category,state:creation.state,inputs:outputs(creation.builder.build()).slice(0,3) as v.Instance['inputs']};
 const stakeCoin=coin(3000000n,stake===q.ZERO?undefined:{category:stake!,amount:10000n}),terms={stake:10000n,duration:512,reward:2000n,maxWins:1};
 const offer=v.atomicOfferBuilder(initial,terms,signer.publicKey,[{...owner,utxo:stakeCoin}],provider,clock,signer);offer.builder.inputs[3]!.unlocker=signer.unlockP2PKH();
 const registered={...initial,state:offer.state,inputs:outputs(offer.builder.build()).slice(0,3) as v.Instance['inputs']};
 const claim=v.transitionBuilder(registered,3,0,provider,clock,fund(coin(v.sponsorAmount(registered,3))),undefined,undefined);
 const cancelled=v.transitionBuilder(registered,1,0,provider,clock,fund(coin(10000n)),signer),cv={...registered,state:cancelled.state,inputs:outputs(cancelled.builder.build()).slice(0,3) as v.Instance['inputs']};
 const refund=v.transitionBuilder(cv,4,0,provider,clock,fund(coin(v.sponsorAmount(cv,4))),signer);
 const locked=outputs(claim.builder.build())[4]!,withdraw=v.withdrawalBuilder(locked,claim.terms!,signer,fund(coin(10000n)),provider);
 const before={create:measure(creation.builder,coins.map(c=>c.utxo)),register:measure(offer.builder,offer.sources),cancel:measure(cancelled.builder,cancelled.sources),refund:measure(refund.builder,refund.sources),claim:measure(claim.builder,claim.sources),withdraw:measure(withdraw,[locked,withdraw.inputs[1]!])};

 const params:q.Parameters={stakingCategory:stake!,rewardCategory:reward!,epoch:1800000000,interval:60,releases:20,cap:2000n},seed={...coin(),lockingBytecode:q.genesis(params,signer.publicKey,provider).lockingBytecode};
 const created=q.create(params,seed,fund(),reward===q.ZERO?[]:[fund(coin(1200n,{category:reward!,amount:40000n}))],signer,provider),c=created.context,[vault,root,reserve]=outputs(created.raw);
 const first=q.insert(c,vault!,root!,terms,signer,[fund(coin(3000000n,stake===q.ZERO?undefined:{category:stake!,amount:10000n}))]),[vault1,root1,a,escrow]=outputs(first.raw);
 const ordinary=q.insert(c,a!,undefined,{...terms,stake:9000n},signer,[fund(coin(3000000n,stake===q.ZERO?undefined:{category:stake!,amount:10000n}))]),[a1,b,escrowB]=outputs(ordinary.raw);
 const highest=q.insert(c,vault1!,a1!,{...terms,stake:20000n},signer,[fund(coin(3000000n,stake===q.ZERO?undefined:{category:stake!,amount:20000n}))]);
 const cancel=q.remove(c,a1!,b!,1,fund(),signer,stake===q.ZERO?undefined:escrowB);
 const claimed=q.remove(c,vault1!,a1!,2,fund(),undefined,stake===q.ZERO?undefined:escrow,reward===q.ZERO?undefined:reserve,1800001201),lock=outputs(claimed.raw)[2]!,withdrawn=q.withdraw(c,first.offer,lock,signer,fund());
 const after=Object.fromEntries(Object.entries({create:created,emptyInsertion:first,ordinaryInsertion:ordinary,highestInsertion:highest,cancel,claim:claimed,withdraw:withdrawn}).map(([name,plan])=>[name,measure(plan.builder,plan.sources)]));
 rows.push({stake,reward,before,after,totalUserActionFees:{before:{register:before.register.fee,cancel:before.cancel.fee+before.refund.fee,winAndWithdraw:before.register.fee+before.claim.fee+before.withdraw.fee},after:{registerEmpty:first.fee.toString(),registerOrdinary:ordinary.fee.toString(),cancel:cancel.fee.toString(),winAndWithdrawEmpty:(first.fee+claimed.fee+withdrawn.fee).toString()}}});
}
await mkdir('docs/blaze2026/linked-queue',{recursive:true});await writeFile('docs/blaze2026/linked-queue/cost-comparison.json',JSON.stringify({at:new Date().toISOString(),method:'Locally Schnorr signed, BCH2026 standard VM validated; 1 sat/byte for queue; V4 fixed 10000 sats. Creation excludes wallet preparation (see README). No public broadcast.',rows},null,2)+'\n');
console.table(rows.map(r=>({stake:r.stake===q.ZERO?'BCH':'token',reward:r.reward===q.ZERO?'BCH':'token',oldOffer:r.before.register.bytes,newOrdinary:r.after.ordinaryInsertion!.bytes,newEmpty:r.after.emptyInsertion!.bytes,newClaim:r.after.claim!.bytes,newCancel:r.after.cancel!.bytes,newWithdraw:r.after.withdraw!.bytes})));
