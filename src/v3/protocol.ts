import {addAnnouncement,announcementScript,DISCOVERY_SCRIPT,DISCOVERY_CARRIER} from './discovery.js';
import {MAX_FUNDING_INPUTS} from '../wallet-funding-policy.js';
import {ZERO,FEE,CARRIER,assetId,assetBytes,validateParameters,validateTerms,decision,initialState,rewardRemaining,advance,allocationSequence,V3_STATE_SIZE,type Asset,type Parameters,type Terms} from './model.js';
export * from './model.js';
import {Buffer} from '../bytes.js';
import {Contract,Network,TransactionBuilder,placeholderP2PKHUnlocker,type NetworkProvider,type SpendableUtxo,type SignatureTemplate,type Unlocker} from 'cashscript';
import {binToHex,encodeCashAddress,hash160,decodeTransaction,hexToBin,createVirtualMachineBch2026,hashTransaction} from '@bitauth/libauth';
import FeeSponsorV3 from '../../artifacts/FeeSponsorV3.json' with {type:'json'};
import RegistryV3 from '../../artifacts/RegistryV3.json' with {type:'json'};
import RegistryGenesisV3 from '../../artifacts/RegistryGenesisV3.json' with {type:'json'};
import RegistryGenesisV4 from '../../artifacts/RegistryGenesisV4.json' with {type:'json'};
import RegistryAtomicV4 from '../../artifacts/RegistryAtomicV4.json' with {type:'json'};
import RegistryAtomicGenesisV4 from '../../artifacts/RegistryAtomicGenesisV4.json' with {type:'json'};
import RegistryAtomicLinkedGenesisV4 from '../../artifacts/RegistryAtomicLinkedGenesisV4.json' with {type:'json'};
import RewardFundingV3 from '../../artifacts/RewardFundingV3.json' with {type:'json'};
import AssetRoleV3 from '../../artifacts/AssetRoleV3.json' with {type:'json'};
import StakeAllocationV3 from '../../artifacts/StakeAllocationV3.json' with {type:'json'};
import {allocationTerms,hashState,offer,remainingCommitment} from '../registry.js';
import {records} from '../arena-core.js';
import {sourceOutput,type KeeperClock,type Sponsor} from '../keeper-core.js';
export interface Instance {parameters:Parameters;category:string;state:Buffer;inputs:[SpendableUtxo,SpendableUtxo,SpendableUtxo]}
import {v3Network as network} from './network.js';
const artifacts={RegistryAtomicV4,RegistryAtomicGenesisV4,RegistryAtomicLinkedGenesisV4,FeeSponsorV3,RegistryV3,RegistryGenesisV3,RegistryGenesisV4,RewardFundingV3,AssetRoleV3,StakeAllocationV3};
export function covenant(name:keyof typeof artifacts,args:(bigint|Uint8Array)[],provider:NetworkProvider){network(provider);return new Contract(artifacts[name],args,{provider,contractType:'p2sh32'});}
export function parameterArgs(p:Parameters){validateParameters(p);return [Buffer.concat([assetBytes(p.stakingAsset),assetBytes(p.rewardAsset)]),BigInt(p.epoch),BigInt(p.periodSeconds),BigInt(p.periods),p.cap];}
export function family(p:Parameters,category:string,provider:NetworkProvider){
 if(!/^[a-f0-9]{64}$/.test(category)||[assetId(p.stakingAsset),assetId(p.rewardAsset)].includes(category))throw Error('State/asset category collision');
 const c=Buffer.from(category,'hex').reverse();return {
 registry:covenant(p.registryVersion===4?'RegistryAtomicV4':'RegistryV3',[c,...parameterArgs(p)],provider),
 escrow:covenant('AssetRoleV3',[Buffer.concat([c,assetBytes(p.stakingAsset),Buffer.from([1])])],provider),
 reserve:covenant('AssetRoleV3',[Buffer.concat([c,assetBytes(p.rewardAsset),Buffer.from([2])])],provider)};
}
/** Only exact fungible prefixes are accepted; token NFTs and unrelated tokens are never fees. */
export function assetOutput(asset:Asset,amount:bigint,base=CARRIER){
 assetId(asset);if(amount<0n)throw Error('Negative asset amount');
 return {amount:base+(asset.kind==='bch'?amount:0n),...(asset.kind==='token'&&amount>0n?{token:{category:asset.category,amount}}:{})};
}
export function matches(input:SpendableUtxo,asset:Asset,amount:bigint,base=CARRIER){const expected=assetOutput(asset,amount,base);return input.satoshis===expected.amount&&!input.token?.nft&&(expected.token?input.token?.category===expected.token.category&&input.token.amount===amount:!input.token);}
export function validateInstance(v:Instance,provider:NetworkProvider){
 validateParameters(v.parameters);const cs=family(v.parameters,v.category,provider),[s,e,r]=v.inputs;
 if(v.state.length!==V3_STATE_SIZE||s.satoshis!==CARRIER||s.lockingBytecode!==cs.registry.lockingBytecode||s.token?.category!==v.category||s.token.amount!==0n||s.token.nft?.capability!=='mutable'||s.token.nft.commitment!==hashState(v.state)||e.lockingBytecode!==cs.escrow.lockingBytecode||r.lockingBytecode!==cs.reserve.lockingBytecode||e.txid!==s.txid||r.txid!==s.txid||s.vout!==0||e.vout!==1||r.vout!==2||!matches(e,v.parameters.stakingAsset,remainingCommitment(v.state))||!matches(r,v.parameters.rewardAsset,rewardRemaining(v.state)))throw Error('V3 protected source mismatch');
 return cs;
}
export function ownerAddress(owner:Uint8Array,provider:NetworkProvider){network(provider);const a=encodeCashAddress({prefix:provider.network===Network.REGTEST?'bchreg':'bchtest',type:'p2pkhWithTokens',payload:hash160(owner)});if(typeof a==='string')throw Error(a);return a.address;}
export function termsFor(v:Instance,slot:number){const r=records(v.state,false)[slot];if(!r)throw Error('Missing allocation winner');return allocationTerms(Buffer.from(r.owner,'hex'),v.category,assetId(v.parameters.stakingAsset),slot,r.wins,r.stake,allocationSequence(r.duration));}
export function stateOutput(category:string,state:Uint8Array){return {amount:CARRIER,token:{category,amount:0n,nft:{capability:'mutable' as const,commitment:hashState(state)}}};}
export function genesisBuilder(p:Parameters,factoryInput:SpendableUtxo,rewardFunding:Sponsor,provider:NetworkProvider){
 const factory=covenant(p.registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(p),provider),cs=family(p,factoryInput.txid,provider),state=initialState(p);
 if(factoryInput.vout!==0||factoryInput.token||factoryInput.satoshis!==12000n||factoryInput.lockingBytecode!==factory.lockingBytecode||!matches(rewardFunding.input,p.rewardAsset,p.cap*BigInt(p.periods)))throw Error('Incorrect factory or exact full reward funding');
 const builder=new TransactionBuilder({provider}).addInput(factoryInput,factory.unlock.create()).addInput(rewardFunding.input,rewardFunding.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(factoryInput.txid,state)}).addOutput({to:cs.escrow.address,amount:CARRIER})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(p.rewardAsset,p.cap*BigInt(p.periods))});return {builder,state};
}
/** Owner-bound V4 genesis + companion reward-funding covenants for one-approval chained creation. */
export function chainedPreparation(p:Parameters,ownerPubkey:Uint8Array,provider:NetworkProvider){
 validateParameters(p);const owner=hash160(ownerPubkey);
 const genesis=covenant(p.registryVersion===4?'RegistryAtomicLinkedGenesisV4':'RegistryGenesisV4',[...parameterArgs(p),owner],provider);
 const funding=covenant('RewardFundingV3',[Buffer.from(genesis.lockingBytecode,'hex'),owner],provider);
 return {genesis,funding,owner};
}
/** Permissionless child: spends parent vout0/vout1 under V4+RewardFunding covenants. No wallet signature. */
export function chainedChildBuilder(p:Parameters,factoryInput:SpendableUtxo,fundingInput:SpendableUtxo,ownerPubkey:Uint8Array,provider:NetworkProvider){
 const prep=chainedPreparation(p,ownerPubkey,provider),cs=family(p,factoryInput.txid,provider),state=initialState(p),reserve=p.cap*BigInt(p.periods);
 if(factoryInput.vout!==0||factoryInput.token||factoryInput.satoshis!==12000n||factoryInput.lockingBytecode!==prep.genesis.lockingBytecode)throw Error('Incorrect chained genesis preparation');
 if(fundingInput.txid!==factoryInput.txid||fundingInput.vout!==1||!matches(fundingInput,p.rewardAsset,reserve))throw Error('Incorrect chained reward funding companion');
 if(fundingInput.lockingBytecode!==prep.funding.lockingBytecode)throw Error('Reward funding covenant mismatch');
 const builder=new TransactionBuilder({provider}).addInput(factoryInput,prep.genesis.unlock.create()).addInput(fundingInput,prep.funding.unlock.fundGenesis())
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(factoryInput.txid,state)}).addOutput({to:cs.escrow.address,amount:CARRIER})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(p.rewardAsset,reserve)});
 return {builder,state,category:factoryInput.txid,prep};
}
export function chainedGenesisRefundBuilder(factoryInput:SpendableUtxo,fee:Sponsor,ownerPubkey:Uint8Array,authorization:SignatureTemplate|Uint8Array,p:Parameters,provider:NetworkProvider){
 const prep=chainedPreparation(p,ownerPubkey,provider);
 if(factoryInput.lockingBytecode!==prep.genesis.lockingBytecode||factoryInput.satoshis!==12000n||factoryInput.token||fee.input.token||fee.input.satoshis!==FEE)throw Error('Invalid genesis refund sources');
 return new TransactionBuilder({provider}).addInput(factoryInput,prep.genesis.unlock.refund(authorization,ownerPubkey)).addInput(fee.input,fee.unlocker)
 .addOutput({to:ownerAddress(ownerPubkey,provider),amount:12000n});
}
export function chainedFundingRecoverBuilder(fundingInput:SpendableUtxo,fee:Sponsor,ownerPubkey:Uint8Array,authorization:SignatureTemplate|Uint8Array,p:Parameters,provider:NetworkProvider){
 const prep=chainedPreparation(p,ownerPubkey,provider),reserve=p.cap*BigInt(p.periods);
 if(fundingInput.lockingBytecode!==prep.funding.lockingBytecode||!matches(fundingInput,p.rewardAsset,reserve)||fee.input.token||fee.input.satoshis!==FEE)throw Error('Invalid funding recovery sources');
 return new TransactionBuilder({provider}).addInput(fundingInput,prep.funding.unlock.recover(authorization,ownerPubkey)).addInput(fee.input,fee.unlocker)
 .addOutput({to:ownerAddress(ownerPubkey,provider),...assetOutput(p.rewardAsset,reserve)});
}
export function chainedParentBuilder(p:Parameters,coins:import('../transactions-core.js').WalletCoin[],owner:import('../transactions-core.js').WalletKey,provider:NetworkProvider){
 validateParameters(p);if(!coins.length||coins.length>MAX_FUNDING_INPUTS||new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('Invalid chained parent funding');
 const prep=chainedPreparation(p,hexToBin(owner.publicKey),provider),reserve=p.cap*BigInt(p.periods),asset=p.rewardAsset;
 let tokens=0n,total=0n;const builder=new TransactionBuilder({provider});
 for(const c of coins){if(c.utxo.token&&(c.utxo.token.nft||asset.kind!=='token'||c.utxo.token.category!==asset.category))throw Error('Unrelated tokens or NFTs cannot fund chained preparation');
 total+=c.utxo.satoshis;tokens+=c.utxo.token?.amount??0n;builder.addInput(c.utxo,placeholderP2PKHUnlocker(ownerAddress(hexToBin(c.publicKey),provider)));}
 if(asset.kind==='token'&&tokens<reserve)throw Error('Insufficient full reward reserve');
 builder.addOutput({to:prep.genesis.address,amount:12000n}).addOutput({to:prep.funding.tokenAddress,...assetOutput(asset,reserve)});
 addAnnouncement(builder,p,'parent',provider);
 const address=ownerAddress(hexToBin(owner.publicKey),provider),tokenChange=asset.kind==='token'?tokens-reserve:0n;
 if(tokenChange>0n&&asset.kind==='token')builder.addOutput({to:address,amount:CARRIER,token:{category:asset.category,amount:tokenChange}});
 const bchChange=total-(p.discovery===1?DISCOVERY_CARRIER:0n)-12000n-FEE-(asset.kind==='bch'?reserve:0n)-CARRIER-(tokenChange>0n?CARRIER:0n);
 if(bchChange<0n||bchChange>0n&&bchChange<CARRIER)throw Error('Insufficient BCH or chained parent change below 1000 satoshis');
 if(bchChange>0n)builder.addOutput({to:address,amount:bchChange});
 return {builder,prep,reserve,bchChange,tokenChange};
}
/** Direct genesis has no factory witness: independently pin every protected output and
 * permit only fungible/BCH change to input wallet scripts. Never consume NFTs. */
export function validateGenesis(p:Parameters,raw:string,inputs:SpendableUtxo[],provider:NetworkProvider){
 validateParameters(p);const tx=decodeTransaction(hexToBin(raw));
 if(typeof tx==='string'||tx.version!==2||!inputs.length||tx.inputs.length!==inputs.length||inputs[0]!.vout!==0||inputs[0]!.token)throw Error('Invalid genesis input/layout');
 const category=inputs[0]!.txid,state=initialState(p),cs=family(p,category,provider);
 for(const [i,u]of inputs.entries())if(binToHex(tx.inputs[i]!.outpointTransactionHash)!==u.txid||tx.inputs[i]!.outpointIndex!==u.vout||u.token?.nft)throw Error('Genesis source mismatch or NFT input');
 const outputs=tx.outputs.map((o,i)=>({txid:hashTransaction(hexToBin(raw)),vout:i,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount,...(o.token.nft?{nft:{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})}));
 if(outputs.length<3)throw Error('Missing genesis roles');
 validateInstance({parameters:p,category,state,inputs:outputs.slice(0,3) as Instance['inputs']},provider);
 const totals=new Map<string,bigint>();
 for(const u of inputs)if(u.token)totals.set(u.token.category,(totals.get(u.token.category)??0n)+u.token.amount);
 const scripts=new Set(inputs.map(u=>u.lockingBytecode).filter(s=>/^76a914[0-9a-f]{40}88ac$/.test(s??'')));
 for(const [i,o]of outputs.entries()){
  if(p.discovery===1&&outputs[3]?.lockingBytecode===DISCOVERY_SCRIPT&&(i===3||i===4)){if(o.token||o.lockingBytecode!==(i===3?DISCOVERY_SCRIPT:announcementScript(p,'direct'))||o.satoshis!==(i===3?DISCOVERY_CARRIER:0n))throw Error('Invalid discovery output');continue;}
  if(i>=3&&(!scripts.has(o.lockingBytecode)||o.satoshis<CARRIER||o.token?.nft))throw Error('Invalid genesis wallet change');
  if(i===0)continue;
  if(o.token){if(o.token.nft||o.token.category===category)throw Error('Unexpected genesis token mint');totals.set(o.token.category,(totals.get(o.token.category)??0n)-o.token.amount);}
 }
 if([...totals.values()].some(n=>n!==0n))throw Error('Genesis must conserve reward and wallet tokens');
 return {category,state,cs};
}
export function directGenesisBuilder(p:Parameters,coins:import('../transactions-core.js').WalletCoin[],change:import('../transactions-core.js').WalletKey,provider:NetworkProvider){
 validateParameters(p);if(!coins.length||coins.length>MAX_FUNDING_INPUTS||coins[0]!.utxo.vout!==0||coins[0]!.utxo.token||new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('A verified token-free wallet vout=0 is required for direct genesis');
 const category=coins[0]!.utxo.txid,cs=family(p,category,provider),state=initialState(p),reserve=p.cap*BigInt(p.periods),asset=p.rewardAsset;
 let tokens=0n,total=0n;const builder=new TransactionBuilder({provider});
 for(const c of coins){if(c.utxo.token&&(c.utxo.token.nft||asset.kind!=='token'||c.utxo.token.category!==asset.category))throw Error('Unrelated tokens or NFTs cannot fund genesis');
 total+=c.utxo.satoshis;tokens+=c.utxo.token?.amount??0n;builder.addInput(c.utxo,placeholderP2PKHUnlocker(ownerAddress(hexToBin(c.publicKey),provider)));}
 if(asset.kind==='token'&&tokens<reserve)throw Error('Insufficient full reward reserve');
 builder.addOutput({to:cs.registry.tokenAddress,...stateOutput(category,state)}).addOutput({to:cs.escrow.address,amount:CARRIER}).addOutput({to:cs.reserve.tokenAddress,...assetOutput(asset,reserve)});
 addAnnouncement(builder,p,'direct',provider);
 const address=ownerAddress(hexToBin(change.publicKey),provider),tokenChange=asset.kind==='token'?tokens-reserve:0n;
 if(tokenChange>0n&&asset.kind==='token')builder.addOutput({to:address,amount:CARRIER,token:{category:asset.category,amount:tokenChange}});
 const bchChange=total-(p.discovery===1?DISCOVERY_CARRIER:0n)-3n*CARRIER-FEE-(asset.kind==='bch'?reserve:0n)-(tokenChange>0n?CARRIER:0n);
 if(bchChange<0n||bchChange>0n&&bchChange<CARRIER)throw Error('Insufficient BCH or genesis change below 1000 satoshis');
 if(bchChange>0n)builder.addOutput({to:address,amount:bchChange});
 return {builder,state,category};
}
// A caller supplies either a wallet placeholder or an actual SignatureTemplate. No key is held here.
export function transitionBuilder(v:Instance,action:number,slot:number,provider:NetworkProvider,clock:KeeperClock,sponsor:Sponsor,authorization?:SignatureTemplate|Uint8Array,registration?:{owner:Uint8Array;terms:Terms;funding:Sponsor},payerChange?:{address:string}) {
 const cs=validateInstance(v,provider),state=v.state;
 if(!Number.isInteger(action)||action<0||action>4||action===2||!Number.isInteger(slot)||slot<0||slot>15)throw Error('Invalid action or slot');
 if(sponsor.input.token)throw Error('Fee sponsor must be token-free BCH');
 let record=Buffer.alloc(0);
 if(action===0){if(!registration)throw Error('Missing registration');const n=validateTerms(v.parameters,registration.terms,rewardRemaining(state));if(!matches(registration.funding.input,v.parameters.stakingAsset,n,v.parameters.stakingAsset.kind==='bch'?0n:CARRIER))throw Error('Incorrect exact stake funding');record=offer(registration.owner,Number(registration.terms.stake),registration.terms.duration,Number(registration.terms.reward),registration.terms.maxWins);}
 if(action===3){const d=decision(v,clock);if(d.phase!=='ready'||d.slot!==slot)throw Error(d.phase==='blocked'?d.reason:'Top offer changed');}
 const next=advance(state,action,slot,record),b=new TransactionBuilder({provider}).setLocktime(Math.max(500000000,clock.mtp-1))
 .addInput(v.inputs[0],cs.registry.unlock.transition(state,BigInt(action),BigInt(slot),record,authorization??Buffer.alloc(0)))
 .addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend());
 if(action===0)b.addInput(registration!.funding.input,registration!.funding.unlocker);
 b.addInput(sponsor.input,sponsor.unlocker)
 .addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,next)})
 .addOutput({to:cs.escrow.tokenAddress,...assetOutput(v.parameters.stakingAsset,remainingCommitment(next))})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(v.parameters.rewardAsset,rewardRemaining(next))});
 let terms:Buffer|undefined;
 if(action===3){const winner=records(state,false)[slot];if(!winner)throw Error('Missing winner');terms=termsFor(v,slot);const a=covenant('StakeAllocationV3',[terms],provider);
 b.addOutput({to:ownerAddress(Buffer.from(winner.owner,'hex'),provider),...assetOutput(v.parameters.rewardAsset,BigInt(winner.reward),v.parameters.rewardAsset.kind==='bch'?0n:CARRIER)})
 .addOutput({to:a.tokenAddress,...assetOutput(v.parameters.stakingAsset,BigInt(winner.stake),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 if(action===4){const r=records(state)[slot];if(!r)throw Error('Missing refund owner');b.addOutput({to:ownerAddress(Buffer.from(r.owner,'hex'),provider),...assetOutput(v.parameters.stakingAsset,BigInt(r.stake)*BigInt(r.maxWins-r.wins),v.parameters.stakingAsset.kind==='bch'?0n:CARRIER)});}
 if(payerChange){
  if(action!==3)throw Error('Caller change is only supported for reward claims');
  const change=sponsor.input.satoshis-sponsorAmount(v,3);
  if(change<0n||change>0n&&change<CARRIER)throw Error('Insufficient BCH or claim change below 1000 satoshis');
  if(change>0n)b.addOutput({to:payerChange.address,amount:change});
 }
 return {builder:b,state:next,terms,sources:[...v.inputs,...(action===0?[registration!.funding.input]:[]),sponsor.input]};
}
export function sponsorAmount(v:Instance,action:number){return FEE+(action===0&&v.parameters.stakingAsset.kind==='token'?-CARRIER:0n)+(action===3?(v.parameters.rewardAsset.kind==='token'?CARRIER:0n)+(v.parameters.stakingAsset.kind==='token'?CARRIER:0n):0n)+(action===4&&v.parameters.stakingAsset.kind==='token'?CARRIER:0n);}
export function withdrawalBuilder(input:SpendableUtxo,terms:Buffer,owner:SignatureTemplate|Uint8Array,sponsor:Sponsor,provider:NetworkProvider){
 const asset:Asset=terms.subarray(78).toString('hex')===ZERO?{kind:'bch'}:{kind:'token',category:Buffer.from(terms.subarray(78)).reverse().toString('hex')},a=covenant('StakeAllocationV3',[terms],provider),amount=BigInt(terms.readUInt32LE(70));
 if(input.lockingBytecode!==a.lockingBytecode||!matches(input,asset,amount,asset.kind==='bch'?0n:CARRIER)||sponsor.input.token||sponsor.input.satoshis!==FEE)throw Error('Invalid withdrawal source or external fee');
 return new TransactionBuilder({provider}).addInput(input,a.unlock.withdraw(owner),{sequence:terms.readUInt32LE(74)}).addInput(sponsor.input,sponsor.unlocker).addOutput({to:ownerAddress(terms.subarray(0,33),provider),...assetOutput(asset,amount,asset.kind==='bch'?0n:CARRIER)});
}
/** Script and absolute finality validation. Relative input ages require chain context. */
export function validateBuilt(raw:string,inputs:SpendableUtxo[],clock:KeeperClock,sourceMtp?:number){
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed v3 transaction');
 if(tx.version!==2||tx.inputs.length!==inputs.length)throw Error('Invalid version or source count');
 if(tx.locktime>=(tx.locktime<500000000?clock.height+1:clock.mtp))throw Error('Transaction is not final');
 for(const [i,input] of tx.inputs.entries())if(input.sequenceNumber<0x80000000){
  if(i!==0||(input.sequenceNumber&0x400000)===0||sourceMtp===undefined)throw Error('Relative maturity requires verified source MTP');
  if(clock.mtp<sourceMtp+(input.sequenceNumber&65535)*512)throw Error('Allocation is not mature');
 }
 const sources=inputs.map(sourceOutput),fee=sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 if(fee!==FEE)throw Error('Incorrect external fee');
 const result=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:sources});if(result!==true)throw Error('V3 covenant validation failed: '+result);
 return {txid:hashTransaction(hexToBin(raw)),fee,transaction:tx};
}

/** One transaction, separate registry-input authorization, and direct P2PKH funding. */
export function atomicOfferBuilder(v:Instance,terms:Terms,owner:Uint8Array,coins:import('../transactions-core.js').WalletCoin[],provider:NetworkProvider,clock:KeeperClock,authorization:SignatureTemplate|Uint8Array){
 if(v.parameters.registryVersion!==4)throw Error('This immutable registry requires legacy registration');
 if(terms.maxWins!==1)throw Error('Atomic offers require maxWins = 1');
 validateTerms(v.parameters,terms,rewardRemaining(v.state));
 const cs=validateInstance(v,provider),asset=v.parameters.stakingAsset;
 if(!coins.length||coins.length>16||new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('Atomic registration requires 1–16 distinct wallet inputs');
 const record=offer(owner,Number(terms.stake),terms.duration,Number(terms.reward),1),state=advance(v.state,0,v.state[5]!,record);
 const builder=new TransactionBuilder({provider}).setLocktime(Math.max(500000000,clock.mtp-1))
 .addInput(v.inputs[0],cs.registry.unlock.transition(v.state,0n,BigInt(v.state[5]!),record,authorization))
 .addInput(v.inputs[1],cs.escrow.unlock.spend()).addInput(v.inputs[2],cs.reserve.unlock.spend());
 let total=0n,tokens=0n;
 for(const c of coins){if(c.utxo.token&&(c.utxo.token.nft||asset.kind!=='token'||c.utxo.token.category!==asset.category))throw Error('Atomic funding excludes NFTs and unrelated tokens');
 total+=c.utxo.satoshis;tokens+=c.utxo.token?.amount??0n;builder.addInput(c.utxo,placeholderP2PKHUnlocker(ownerAddress(hexToBin(c.publicKey),provider)));}
 builder.addOutput({to:cs.registry.tokenAddress,...stateOutput(v.category,state)})
 .addOutput({to:cs.escrow.tokenAddress,...assetOutput(asset,remainingCommitment(state))})
 .addOutput({to:cs.reserve.tokenAddress,...assetOutput(v.parameters.rewardAsset,rewardRemaining(state))});
 const tokenChange=asset.kind==='token'?tokens-terms.stake:0n,address=ownerAddress(owner,provider);
 if(tokenChange<0n)throw Error('Insufficient staking tokens');
 if(tokenChange>0n&&asset.kind==='token')builder.addOutput({to:address,amount:CARRIER,token:{category:asset.category,amount:tokenChange}});
 const bchChange=total-FEE-(asset.kind==='bch'?terms.stake:0n)-(tokenChange>0n?CARRIER:0n);
 if(bchChange<0n||bchChange>0n&&bchChange<CARRIER)throw Error('Insufficient BCH or atomic change below 1000 satoshis');
 if(bchChange>0n)builder.addOutput({to:address,amount:bchChange});
 return {builder,state,bchChange,tokenChange,sources:[...v.inputs,...coins.map(c=>c.utxo)]};
}
