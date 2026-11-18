import {BchFundingError} from './funding.js';
import {Buffer} from '../bytes.js';
import {Contract,TransactionBuilder,type NetworkProvider,type SpendableUtxo,type SignatureTemplate,type Unlocker} from 'cashscript';
import {binToHex,hash160,hexToBin,decodeTransaction,createVirtualMachineBch2026,type Transaction} from '@bitauth/libauth';
import Arena from '../../artifacts/queue/Global.json' with {type:'json'};
import Node from '../../artifacts/queue/Node.json' with {type:'json'};
import Root from '../../artifacts/queue/Root.json' with {type:'json'};
import AssetGate from '../../artifacts/queue/AssetGate.json' with {type:'json'};
import Allocation from '../../artifacts/queue/Allocation.json' with {type:'json'};
import {CARRIER,ZERO,parameters,category,validateScore,identifier,compare,emptyLink,record,score,state,decodeOffer,decodeState,type Identity,type Parameters,type Score,type Offer,type State} from './model.js';
export * from './model.js';
export interface Funding {input:SpendableUtxo;unlocker:Unlocker}
export type Authorization=SignatureTemplate|{publicKey:Uint8Array;authorization:Uint8Array};
const signature=(owner:Authorization)=>'authorization' in owner?owner.authorization:owner;
export interface Context {p:Parameters;identity:Identity;provider:NetworkProvider}
export function arena(c:Context){const {assets,schedule}=parameters(c.p),v=category(c.identity.vault),q=category(c.identity.queue);if(v.equals(q)||[c.p.stakingCategory,c.p.rewardCategory,ZERO].includes(c.identity.vault)||[c.p.stakingCategory,c.p.rewardCategory,ZERO].includes(c.identity.queue))throw Error('Category collision');return new Contract(Arena,[Buffer.concat([v,q,assets]),schedule,hexToBin(node(c).lockingBytecode)],{provider:c.provider,contractType:'p2sh32'});}
export function node(c:Context){const {assets}=parameters(c.p);return new Contract(Node,[Buffer.concat([category(c.identity.vault),category(c.identity.queue),assets.subarray(0,32),Buffer.from([c.p.rewardCategory===ZERO?1:0])])],{provider:c.provider,contractType:'p2sh32'});}
export function root(c:Context){return new Contract(Root,[category(c.identity.vault)],{provider:c.provider,contractType:'p2sh32'});}
export function gate(c:Context,id=ZERO){return new Contract(AssetGate,[category(c.identity.vault),category(c.identity.queue),hexToBin(node(c).lockingBytecode),Buffer.from(id,'hex')],{provider:c.provider,contractType:'p2sh32'});}
export function allocation(c:Context,o:Offer){return new Contract(Allocation,[Buffer.from(o.owner,'hex'),category(c.p.stakingCategory),o.stake,BigInt(o.duration)],{provider:c.provider,contractType:'p2sh32'});}
export const ownerScript=(owner:Uint8Array)=>hexToBin('76a914'+binToHex(hash160(owner))+'88ac');
export function asset(category:string,amount:bigint,base=CARRIER){return category===ZERO?{amount:base+amount}:{amount:base,...(amount?{token:{category,amount}}:{})};}
export function nft(category:string,commitment:Uint8Array,capability:'mutable'|'minting'){return {category,amount:0n,nft:{capability,commitment:Buffer.from(commitment).toString('hex')}};}
export function stateOutput(c:Context,s:State){return {to:arena(c).tokenAddress,amount:CARRIER+(c.p.rewardCategory===ZERO?s.reserve:0n),token:nft(c.identity.vault,state(s),'mutable')};}
export function nodeOutput(c:Context,o:Offer){return {to:node(c).tokenAddress,amount:CARRIER+(c.p.stakingCategory===ZERO?o.stake:0n),token:nft(c.identity.queue,record(o),'minting')};}
export function source(u:SpendableUtxo){if(!u.lockingBytecode)throw Error('Missing source script');return {valueSatoshis:u.satoshis,lockingBytecode:hexToBin(u.lockingBytecode),...(u.token?{token:{category:hexToBin(u.token.category),amount:u.token.amount,...(u.token.nft?{nft:{capability:u.token.nft.capability,commitment:hexToBin(u.token.nft.commitment)}}:{})}}:{})};}
export function readNode(c:Context,u:SpendableUtxo){if(u.lockingBytecode!==node(c).lockingBytecode||u.token?.category!==c.identity.queue||u.token.amount!==0n||u.token.nft?.capability!=='minting')throw Error('Unauthenticated node');const o=decodeOffer(hexToBin(u.token.nft.commitment));validateScore(o,c.p);if(o.id===ZERO||u.satoshis!==CARRIER+(c.p.stakingCategory===ZERO?o.stake:0n))throw Error('Incorrect node collateral');return o;}
export function readState(c:Context,u:SpendableUtxo){if(u.lockingBytecode!==arena(c).lockingBytecode||u.token?.category!==c.identity.vault||u.token.amount!==0n||u.token.nft?.capability!=='mutable')throw Error('Unauthenticated vault');const s=decodeState(hexToBin(u.token.nft.commitment));if(s.reserve>BigInt(c.p.releases)*c.p.cap||u.satoshis!==CARRIER+(c.p.rewardCategory===ZERO?s.reserve:0n))throw Error('Incorrect reserve');return s;}
const fundingFailures=new WeakMap<TransactionBuilder,BchFundingError>();
export function fundingRemainder(builder:TransactionBuilder,available:bigint,required:bigint,fee:bigint,phase='creation',allowZero=true){
 const amount=available-required-fee;
 if(amount<546n&&(amount!==0n||!allowZero)){fundingFailures.set(builder,new BchFundingError(required+fee+546n,available,fee,phase));return 546n;}
 return amount;
}
function change(builder:TransactionBuilder,funding:Funding[],category:string,required:bigint,owner:Uint8Array,fee:bigint,protectedDelta:bigint,phase='creation'){
 let bch=0n,tokens=0n;
 for(const {input,unlocker}of funding){if(input.token&&(input.token.nft||category===ZERO||input.token.category!==category))throw Error('Unrelated funding token or NFT');bch+=input.satoshis;tokens+=input.token?.amount??0n;builder.addInput(input,unlocker);}
 const remainder=tokens-(category===ZERO?0n:required);if(remainder<0n)throw Error('Insufficient tokens: '+required+' raw units required; '+tokens+' available in selected inputs');
 if(remainder>0n){builder.addOutput({to:ownerScript(owner),...asset(category,remainder)});protectedDelta+=CARRIER;}
 const amount=fundingRemainder(builder,bch,protectedDelta,fee,phase);if(amount>0n)builder.addOutput({to:ownerScript(owner),amount});
}
/** Rebuild before approval until the fee equals signed byte count × policy rate.
 * Schnorr signatures have fixed size. The returned signed bytes are immutable. */
export function priced(make:(fee:bigint)=>TransactionBuilder,sources:SpendableUtxo[],satPerByte=1n){
 if(satPerByte<1n||satPerByte>100n)throw Error('Invalid fee policy');let fee=0n;
 for(let i=0;i<6;i++){const builder=make(fee),next=builder.getTransactionSize()*satPerByte;if(next===fee){const failure=fundingFailures.get(builder);if(failure)throw failure;const raw=builder.build(),tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error(tx);const actual=sources.reduce((n,u)=>n+u.satoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);if(actual!==fee)throw Error('Fee conservation failure');return {builder,raw,fee,bytes:Number(builder.getTransactionSize()),sources};}fee=next;}
 throw Error('Signed fee did not converge');
}
export function verify(plan:{raw:string;sources:SpendableUtxo[]}){const tx=decodeTransaction(hexToBin(plan.raw));if(typeof tx==='string')throw Error(tx);const result=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:plan.sources.map(source)});if(result!==true)throw Error(String(result));return tx;}
/** Both category genesis authorities are ordinary wallet output-zero coins.
 * The immutable origin is authenticated in full by authenticateGenesis(). */
export function create(p:Parameters,vault:Funding,queue:Funding,funding:Funding[],owner:Authorization,provider:NetworkProvider,rate=1n,listing?:{cost:bigint;add:(b:TransactionBuilder,c:Context)=>void}){
 parameters(p);
 if(vault.input.vout!==0||queue.input.vout!==0||vault.input.txid===queue.input.txid||vault.input.token||queue.input.token)throw Error('Atomic creation requires two distinct token-free wallet output-zero UTXOs');
 const c={p,identity:{vault:vault.input.txid,queue:queue.input.txid},provider},s={head:emptyLink(),reserve:BigInt(p.releases)*p.cap};arena(c);
 const all=[vault,queue,...funding],inputs=all.map(f=>f.input);
 if(inputs.length>16||new Set(inputs.map(u=>u.txid+':'+u.vout)).size!==inputs.length)throw Error('Invalid genesis funding');
 const plan=priced(fee=>{const builder=new TransactionBuilder({provider})
 .addOutput(stateOutput(c,s)).addOutput({to:root(c).tokenAddress,amount:CARRIER,token:nft(c.identity.queue,Uint8Array.of(0),'minting')});
 if(p.rewardCategory!==ZERO)builder.addOutput({to:gate(c).tokenAddress,...asset(p.rewardCategory,s.reserve)});
 listing?.add(builder,c);
 change(builder,all,p.rewardCategory,s.reserve,owner.publicKey,fee,CARRIER*2n+(p.rewardCategory===ZERO?s.reserve:CARRIER)+(listing?.cost??0n));return builder;},inputs,rate);
 return {...plan,context:c};
}
export function insert(c:Context,controller:SpendableUtxo,authority:SpendableUtxo|undefined,terms:Score,owner:Authorization,funding:Funding[],rate=1n){
 validateScore(terms,c.p);if(!funding.length)throw Error('Missing offer funding');const head=!!authority,a=head?arena(c):node(c),s=head?readState(c,controller):undefined,pred=head?undefined:readNode(c,controller),old=s?.head??pred!.next;
 if(pred&&compare(pred,terms)<0||old.id!==ZERO&&compare(terms,old)<=0)throw Error('Offer outside insertion interval (ties follow earlier offers)');
 const id=identifier(funding[0]!.input.txid,funding[0]!.input.vout),o:Offer={...terms,id,owner:binToHex(owner.publicKey),next:old};
 const inputs=[controller,...(authority?[authority]:[]),...funding.map(f=>f.input)];
 const plan=priced(fee=>{const builder=new TransactionBuilder({provider:c.provider}).addInput(controller,a.unlock.transition(0n,Buffer.concat([Buffer.from(owner.publicKey),score(terms)]),signature(owner)));
 if(authority){builder.addInput(authority,authority.token?.nft?.commitment==='00'?root(c).unlock.initialize():node(c).unlock.authorize());builder.addOutput(stateOutput(c,{...s!,head:o})).addOutput({to:hexToBin(authority.lockingBytecode!),amount:authority.satoshis,token:authority.token!});}
 else builder.addOutput(nodeOutput(c,{...pred!,next:o}));
 builder.addOutput(nodeOutput(c,o));let delta=CARRIER+(c.p.stakingCategory===ZERO?terms.stake:CARRIER);
 if(c.p.stakingCategory!==ZERO)builder.addOutput({to:gate(c,id).tokenAddress,...asset(c.p.stakingCategory,terms.stake)});
 change(builder,funding,c.p.stakingCategory,terms.stake,owner.publicKey,fee,delta,'offer registration');return builder;},inputs,rate);
 return {...plan,offer:o};
}
export function remove(c:Context,controller:SpendableUtxo,removed:SpendableUtxo,action:1|2|3,payer:Funding|Funding[],owner?:Authorization,escrow?:SpendableUtxo,reserve?:SpendableUtxo,locktime=0,rate=1n){
 const o=readNode(c,removed),head=controller.token?.category===c.identity.vault,s=head?readState(c,controller):undefined,pred=head?undefined:readNode(c,controller);
 if((s?.head??pred!.next).id!==o.id)throw Error('Node is not the authenticated successor');if(action!==1&&!head)throw Error('Claims require the true head');if(action===1&&(!owner||binToHex(owner.publicKey)!==o.owner))throw Error('Cancellation requires owner');
 const payers=Array.isArray(payer)?payer:[payer];if(!payers.length||payers.length>16||payers.some(p=>p.input.token))throw Error('One to sixteen BCH fee inputs required');
 const a=head?arena(c):node(c),inputs=[controller,removed];if(c.p.stakingCategory!==ZERO){if(!escrow)throw Error('Missing offer escrow');inputs.push(escrow);}if(action===2&&c.p.rewardCategory!==ZERO){if(!reserve)throw Error('Missing reserve');inputs.push(reserve);}inputs.push(...payers.map(p=>p.input));
 const plan=priced(fee=>{const b=new TransactionBuilder({provider:c.provider}).setLocktime(locktime).addInput(controller,a.unlock.transition(BigInt(action),new Uint8Array(),action===1?signature(owner!):new Uint8Array())).addInput(removed,node(c).unlock.authorize());
 if(escrow)b.addInput(escrow,gate(c,o.id).unlock.release());if(action===2&&reserve)b.addInput(reserve,gate(c).unlock.release());for(const p of payers)b.addInput(p.input,p.unlocker);
 const after=s?{head:o.next,reserve:s.reserve-(action===2?o.reward:0n)}:undefined;
 b.addOutput(after?stateOutput(c,after):nodeOutput(c,{...pred!,next:o.next}));
 if(action===2){b.addOutput({to:ownerScript(hexToBin(o.owner)),...asset(c.p.rewardCategory,o.reward)}).addOutput({to:allocation(c,o).tokenAddress,...asset(c.p.stakingCategory,o.stake,c.p.stakingCategory===ZERO?0n:CARRIER)});if(c.p.rewardCategory!==ZERO)b.addOutput({to:gate(c).tokenAddress,...asset(c.p.rewardCategory,after!.reserve)});}
 else b.addOutput({to:ownerScript(hexToBin(o.owner)),...asset(c.p.stakingCategory,o.stake,c.p.stakingCategory===ZERO?CARRIER:2n*CARRIER)});
 const total=payers.reduce((n,p)=>n+p.input.satoshis,0n);if(total<fee)throw Error('Insufficient BCH');if(total>fee)b.addOutput({to:hexToBin(payers[0]!.input.lockingBytecode!),amount:total-fee});return b;},inputs,rate);
 return plan;
}
export function withdraw(c:Context,o:Offer,locked:SpendableUtxo,owner:Authorization,payer:Funding|Funding[],rate=1n){const payers=Array.isArray(payer)?payer:[payer];if(!payers.length||payers.length>16||payers.some(p=>p.input.token))throw Error('One to sixteen BCH fee inputs required');return priced(fee=>{
 const b=new TransactionBuilder({provider:c.provider}).addInput(locked,allocation(c,o).unlock.withdraw(signature(owner)),{sequence:4194304+o.duration/512});
 for(const p of payers)b.addInput(p.input,p.unlocker);
 b.addOutput({to:ownerScript(owner.publicKey),...asset(c.p.stakingCategory,o.stake,c.p.stakingCategory===ZERO?0n:CARRIER)});
 const total=payers.reduce((n,p)=>n+p.input.satoshis,0n);if(total<fee)throw Error('Insufficient BCH');if(total>fee)b.addOutput({to:hexToBin(payers[0]!.input.lockingBytecode!),amount:total-fee});return b;
},[locked,...payers.map(p=>p.input)],rate);}
