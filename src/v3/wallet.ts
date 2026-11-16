import {finalityLimit} from '../consensus-clock.js';
import {reconcileAtomicOffer} from './offer-status.js';
import {timed} from '../operation-timing.js';
import {ProviderVerificationError} from '../verified-providers.js';
import {addAnnouncement,announcementScript,discoveryScripts,DISCOVERY_CARRIER} from './discovery.js';
import {selectAtomicFunding} from './atomic-funding.js';
import {fundingReport,fundingOutpoints,reservesFunding,type FundingReport} from './funding-report.js';
import {FUNDING_BYTE_BUDGET,FundingSelectionError} from '../wallet-funding-policy.js';
import {encodeTransaction} from '@bitauth/libauth';
import {discoverFunding} from './funding-discovery.js';
import {validateNewOffer} from './offer-policy.js';
import {v3Network,v3Storage,assertStoredNetwork,type V3Network} from './network.js';
import {TransactionBuilder,placeholderP2PKHUnlocker,placeholderSignature,type SpendableUtxo,type NetworkProvider} from 'cashscript';
import {hexToBin,binToHex,createVirtualMachineBch2026,hashTransaction,decodeTransaction,type Transaction} from '@bitauth/libauth';
import {Buffer} from '../bytes.js';
import {walletScript,validateWalletSigned,walletPlanIdentity,type BrowserPlan,type WalletKey,type WalletCoin} from '../transactions-core.js';
import {chooseBch,chooseTokens,verifyCoinsAcrossPeers as verifyConfirmedCoinsAcrossPeers,confirmedWalletTransaction,walletPeers,verifyCoins} from '../electrum-wallet.js';
import {ChainExtension,type ElectrumCore} from '../electrum-core.js';
import {utxo,records} from '../arena-core.js';
import {AssetIndexer,type Config,type Snapshot} from './indexer.js';
import {atomicOfferBuilder,directGenesisBuilder,validateGenesis,ownerAddress,FEE,CARRIER,decision,assetOutput,covenant,parameterArgs,validateParameters,validateTerms,genesisBuilder,chainedParentBuilder,chainedChildBuilder,chainedPreparation,transitionBuilder,sponsorAmount,withdrawalBuilder,rewardRemaining,type Parameters,type Terms,type Asset} from './protocol.js';
const verifyCoinsAcrossPeers=(p:ElectrumCore,coins:SpendableUtxo[],progress?:(message:string)=>void)=>timed(p,'input-verification',()=>verifyConfirmedCoinsAcrossPeers(p,coins,true,progress));
export interface Operation {acceptedAt?:number;verifiedAt?:number;observation?:'propagating'|'pending'|'confirmed'|'conflicted'|'not-observed'|'unavailable';network?:V3Network;id:string;version:3;creationMode?:'direct'|'chained';registrationMode?:'atomic';offerPolicy?:'single-win';kind:'create'|'offer'|'action'|'withdraw'|'claim';step:'funding'|'action'|'complete';signing?:'unsigned'|'requested'|'rejected';stage:'review'|'prepared'|'pending'|'confirmed'|'conflicted';parameters:Parameters;config?:Config;terms?:Terms;action?:number;slot?:number;allocation?:string;owner:WalletKey;payer?:WalletKey;source?:string;plan?:BrowserPlan;raw?:string;txid?:string;funding?:string;fundingRaw?:string;fundingPlan?:BrowserPlan;childRaw?:string;error?:string;confirmations?:number}
export interface Store {list():Promise<Operation[]>;save(value:Operation):Promise<void>}
function plan(builder:TransactionBuilder,label:string,coins:{coin:WalletCoin;index:number}[],authorization?:WalletKey):BrowserPlan {
 const request=builder.generateWcTransactionObject({broadcast:false,userPrompt:`V3 EXPERIMENTAL ${v3Network(builder.provider).toUpperCase()} ${v3Network(builder.provider)==='mainnet'?'REAL BCH':'TEST FUNDS'}: `+label}),tx=request.transaction as Transaction;
 const signers:Record<number,string>={},inputPaths:BrowserPlan['inputPaths']=[];
 for(const {coin:c,index}of coins){if(c.utxo.lockingBytecode!==walletScript(c.publicKey))throw Error('Wallet key/source mismatch');signers[index]=c.publicKey;inputPaths.push([index,c.path,c.index]);}
 if(authorization){signers[0]=authorization.publicKey;inputPaths.unshift([0,authorization.path,authorization.index]);}
 const fee=request.sourceOutputs.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 return {kind:'offer',label,request,signers,inputPaths,fee:fee.toString()};
}
function directPlan(parameters:Parameters,coins:WalletCoin[],provider:NetworkProvider){
 const built=directGenesisBuilder(parameters,coins,coins[0]!,provider),reserve=parameters.cap*BigInt(parameters.periods),asset=parameters.rewardAsset,total=coins.reduce((n,c)=>n+c.utxo.satoshis,0n),tokenChange=asset.kind==='token'?coins.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n)-reserve:0n,bchChange=total-FEE-3n*CARRIER-(asset.kind==='bch'?reserve:0n)-(tokenChange>0n?CARRIER:0n);
 return plan(built.builder,`Create vault in one transaction; full reserve ${reserve} ${asset.kind} raw units; total BCH inputs ${total} sats; miner fee ${FEE} sats; covenant carriers 3000 sats; wallet change ${bchChange} BCH sats + ${tokenChange} reward tokens; category ${built.category}; immutable parameters ${JSON.stringify(parameters,(_,v)=>typeof v==='bigint'?v.toString():v)}`,coins.map((coin,index)=>({coin,index})));
}
function chainedPlan(parameters:Parameters,coins:WalletCoin[],owner:WalletKey,provider:NetworkProvider){
 const built=chainedParentBuilder(parameters,coins,owner,provider),asset=parameters.rewardAsset,total=coins.reduce((n,c)=>n+c.utxo.satoshis,0n);
 return plan(built.builder,`Create vault with one approval via covenant-controlled preparation: parent locks genesis carrier + full reserve ${built.reserve} ${asset.kind}; child is permissionless (no second signature); parent fee ${FEE} sats; child fee prepaid in 12000-sat carrier; wallet change ${built.bchChange} BCH sats + ${built.tokenChange} reward tokens; total BCH inputs ${total}; immutable parameters ${JSON.stringify(parameters,(_,v)=>typeof v==='bigint'?v.toString():v)}`,coins.map((coin,index)=>({coin,index})));
}
const keyCoin=(key:WalletKey,input:SpendableUtxo):WalletCoin=>({...key,utxo:input});
const sponsor=(key:WalletKey,input:SpendableUtxo,provider:NetworkProvider)=>({input,unlocker:placeholderP2PKHUnlocker(ownerAddress(hexToBin(key.publicKey),provider))});
function planCoins(plan:BrowserPlan):SpendableUtxo[]{
 const tx=plan.request.transaction as Transaction;return plan.request.sourceOutputs.map((s,n)=>({txid:Buffer.from(tx.inputs[n]!.outpointTransactionHash).toString('hex'),vout:tx.inputs[n]!.outpointIndex,satoshis:s.valueSatoshis,lockingBytecode:Buffer.from(s.lockingBytecode).toString('hex'),...(s.token?{token:{category:Buffer.from(s.token.category).toString('hex'),amount:s.token.amount,...(s.token.nft?{nft:{capability:s.token.nft.capability,commitment:Buffer.from(s.token.nft.commitment).toString('hex')}}:{})}}:{})}));
}
/** Check persisted funding plans as data before accepting wallet signatures. */
export function validateFundingPlan(op:Operation,provider:NetworkProvider){
 if(op.kind==='offer'&&op.offerPolicy==='single-win')validateNewOffer(op.parameters,op.terms!);
 if(op.plan?.request.broadcast!==false)throw Error('V3 wallet requests must disable wallet broadcasting');
 if(!op.plan||BigInt(op.plan.fee)!==FEE)throw Error('Unexpected v3 wallet fee');
 if(op.step!=='funding'&&!(op.kind==='create'&&op.creationMode==='chained'&&op.step==='action'))return;
 const discovery=op.kind==='create'&&op.parameters.discovery===1;
 if(discovery){const outputs=op.plan.request.transaction.outputs;for(const i of [2,3]){const output=outputs[i];if(!output||output.token||output.valueSatoshis!==(i===2?DISCOVERY_CARRIER:0n)||!(i===2?discoveryScripts(v3Network(provider)).includes(binToHex(output.lockingBytecode)):binToHex(output.lockingBytecode)===announcementScript(op.parameters,'parent')))throw Error('Wallet preparation changes public discovery outputs');}}
 if(op.creationMode==='chained'&&op.kind==='create'){
  const asset=op.parameters.rewardAsset,category=asset.kind==='token'?asset.category:undefined,prep=chainedPreparation(op.parameters,hexToBin(op.owner.publicKey),provider);
  let inputTokens=0n,outputTokens=0n;const tx=op.plan.request.transaction as Transaction,owner=walletScript(op.owner.publicKey);
  for(const source of op.plan.request.sourceOutputs){if(source.token?.nft||source.token&&binToHex(source.token.category)!==category)throw Error('Unrelated tokens or NFTs in chained funding');inputTokens+=source.token?.amount??0n;}
  const first=tx.outputs[0],second=tx.outputs[1],expected=assetOutput(asset,op.parameters.cap*BigInt(op.parameters.periods),CARRIER);
  if(!first||first.token||first.valueSatoshis!==12000n||binToHex(first.lockingBytecode)!==prep.genesis.lockingBytecode)throw Error('Chained parent changes RegistryGenesisV4 carrier');
  if(!second||second.valueSatoshis!==expected.amount||binToHex(second.lockingBytecode)!==prep.funding.lockingBytecode||(expected.token?second.token?.amount!==expected.token.amount||binToHex(second.token.category)!==expected.token.category:!!second.token))throw Error('Chained parent changes RewardFundingV3 reserve');
  for(const [i,output]of tx.outputs.entries()){
   if(output.token?.nft||output.token&&binToHex(output.token.category)!==category)throw Error('Unexpected chained funding token output');outputTokens+=output.token?.amount??0n;
   if(discovery&&(i===2||i===3))continue;
   if(i>1&&binToHex(output.lockingBytecode)!==owner)throw Error('Chained parent diverts wallet change');
  }
  if(inputTokens!==outputTokens)throw Error('Chained parent must conserve all fungible tokens');
  return;
 }
 if(op.step!=='funding')return;
 const asset:Asset=op.kind==='create'?op.parameters.rewardAsset:op.kind==='offer'?op.parameters.stakingAsset:{kind:'bch'},category=asset.kind==='token'?asset.category:undefined;
 let inputTokens=0n,outputTokens=0n;
 for(const source of op.plan.request.sourceOutputs){if(source.token?.nft||source.token&&binToHex(source.token.category)!==category)throw Error('Unrelated tokens or NFTs in wallet funding');inputTokens+=source.token?.amount??0n;}
 const tx=op.plan.request.transaction as Transaction,owner=walletScript(op.owner.publicKey);
 const exact=(index:number,asset:Asset,units:bigint,base:bigint)=>{const output=tx.outputs[index],expected=assetOutput(asset,units,base);return output&&output.valueSatoshis===expected.amount&&(expected.token?output.token?.amount===expected.token.amount&&binToHex(output.token.category)===expected.token.category:!output.token);};
 if(op.kind==='create'){
  const factory=covenant(op.parameters.registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(op.parameters),provider),first=tx.outputs[0];
  if(!first||first.token||first.valueSatoshis!==12000n||binToHex(first.lockingBytecode)!==factory.lockingBytecode||!exact(1,asset,op.parameters.cap*BigInt(op.parameters.periods),CARRIER))throw Error('Wallet preparation changes factory or full reward reserve');
 }else if(op.kind==='offer'){
  if(!op.terms||!exact(0,asset,validateTerms(op.parameters,op.terms),asset.kind==='bch'?0n:CARRIER)||!exact(1,{kind:'bch'},FEE-(asset.kind==='token'?CARRIER:0n),0n))throw Error('Wallet preparation changes exact stake or sponsor');
 }else{
  const extra=op.kind==='withdraw'?FEE:FEE+(op.action===3?(op.parameters.rewardAsset.kind==='token'?CARRIER:0n)+(op.parameters.stakingAsset.kind==='token'?CARRIER:0n):0n)+(op.action===4&&op.parameters.stakingAsset.kind==='token'?CARRIER:0n);
  if(!exact(0,{kind:'bch'},extra,0n))throw Error('Wallet preparation changes exact BCH sponsor');
 }

 for(const [i,output]of tx.outputs.entries()){
  if(output.token?.nft||output.token&&binToHex(output.token.category)!==category)throw Error('Unexpected wallet funding token output');outputTokens+=output.token?.amount??0n;
  if(discovery&&(i===2||i===3))continue;
  if(!(op.kind==='create'&&i===0)&&binToHex(output.lockingBytecode)!==owner)throw Error('Wallet preparation diverts funding or change');
 }
 if(inputTokens!==outputTokens)throw Error('Wallet preparation must conserve all fungible tokens');
}
function validateIntent(op:Pick<Operation,'kind'|'parameters'> & Partial<Operation>,owner:WalletKey,snapshot:Snapshot){
 if(snapshot.pending.length)throw Error('Vault has pending spends');
 const state=snapshot.instance.state;
 if(op.kind==='offer'){if(state[5]!>=16)throw Error('Registration is closed');(op.offerPolicy==='single-win'?validateNewOffer:validateTerms)(snapshot.config,op.terms!,rewardRemaining(state));return;}
 if(op.kind==='withdraw'){const a=snapshot.allocations.find(a=>a.id===op.allocation);if(!a||!a.mature||a.withdrawal||a.pending||a.terms.subarray(0,33).toString('hex')!==owner.publicKey)throw Error('Allocation unavailable, immature, or not owned');return;}
 if(op.action===1||op.action===4){const entry=records(state)[op.slot??0];if(!entry||entry.owner!==owner.publicKey)throw Error('Offer is not owned by this wallet');if(op.action===1&&entry.cancelled)throw Error('Offer is already cancelled');if(op.action===4&&(!entry.cancelled||entry.refunded||entry.wins>=entry.maxWins))throw Error('Remaining stake cannot be refunded in the current state');return;}
 const next=decision(snapshot.instance,snapshot.clock);if(next.phase!=='ready'||next.action!==op.action||next.slot!==(op.slot??0))throw Error('Claim head changed; refresh canonical state');
}
/** Bind unsigned plans to the relevant canonical source, not a wall-clock deadline. */
function intentSource(op:Partial<Operation>,snapshot:Snapshot){
 if(op.kind==='withdraw'){const input=snapshot.allocations.find(a=>a.id===op.allocation)?.input;return input?`${input.txid}:${input.vout}`:undefined;}
 return snapshot.instance.inputs[0].txid;
}
/** Direct creation and claims use one approval; legacy funded actions use two. Journal public plans and signed bytes
 * before broadcast; retries reconcile the exact txid and never silently spend fresh coins.
 */
export class AssetWallet {
 constructor(readonly provider:ElectrumCore,readonly store:Store,readonly progress:(message:string)=>void=()=>{},readonly onFundingReport:(report:FundingReport)=>void=()=>{}){v3Network(provider);}
 async create(parameters:Parameters,keys:WalletKey[]){
 parameters={...parameters,discovery:1};
 validateParameters(parameters);const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Receive child zero required');
 const journal=await this.store.list(),reserved=new Set(journal.filter(reservesFunding).flatMap(o=>o.plan?planCoins(o.plan).map(u=>u.txid+':'+u.vout):[]));
 const asset=parameters.rewardAsset,reserve=parameters.cap*BigInt(parameters.periods),excluded=new Map<string,string>();
 let verifiedSelection='';const identity=(coins:WalletCoin[])=>coins.map(c=>c.utxo.txid+':'+c.utxo.vout).join(',');
 const selectDirect=(inventory:WalletCoin[])=>{const coins=inventory.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout)&&!excluded.has(c.utxo.txid+':'+c.utxo.vout));
 const genesis=coins.filter(c=>c.utxo.vout===0&&!c.utxo.token&&![parameters.stakingAsset,parameters.rewardAsset].some(a=>a.kind==='token'&&a.category===c.utxo.txid)).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)[0];
 if(!genesis)throw Error('No suitable token-free output 0');
 let selected=asset.kind==='token'?chooseTokens(coins,asset.category,reserve):[];
 selected=[genesis,...selected.filter(c=>c.utxo.txid!==genesis.utxo.txid||c.utxo.vout!==0)];
 const tokenChange=asset.kind==='token'&&selected.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n)>reserve,required=(parameters.discovery===1?CARRIER:0n)+FEE+3n*CARRIER+(asset.kind==='bch'?reserve:0n)+(tokenChange?CARRIER:0n);
 selected=chooseBch(coins,required,selected);const change=selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-required;
 if(change>0n&&change<CARRIER)selected=chooseBch(coins,required+CARRIER,selected);return selected;
 };
 // Chained path only needs eligible BCH + reward assets; it does not search for vout=0.
 const selectChained=(inventory:WalletCoin[])=>{const coins=inventory.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout)&&!excluded.has(c.utxo.txid+':'+c.utxo.vout));
 let selected=asset.kind==='token'?chooseTokens(coins,asset.category,reserve):[];
 const tokenChange=asset.kind==='token'&&selected.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n)>reserve;
 const required=(parameters.discovery===1?CARRIER:0n)+12000n+FEE+CARRIER+(asset.kind==='bch'?reserve:0n)+(tokenChange?CARRIER:0n);
 selected=chooseBch(coins,required,selected);const change=selected.reduce((n,c)=>n+c.utxo.satoshis,0n)-required;
 if(change>0n&&change<CARRIER)selected=chooseBch(coins,required+CARRIER,selected);return selected;
 };
 this.progress('Finding wallet funds…');
 const select=(coins:WalletCoin[])=>{try{return selectDirect(coins);}catch{return selectChained(coins);}};
 const inventory=await discoverFunding(this.provider,keys,async coins=>{
  for(let attempt=0;attempt<=coins.length;attempt++){
   let candidate:WalletCoin[];try{candidate=select(coins);}catch{return false;}
   try{await verifyCoinsAcrossPeers(this.provider,candidate.map(c=>c.utxo),this.progress);verifiedSelection=identity(candidate);return true;}
   catch(error){
    // A contradictory snapshot must not be disguised as a low balance.
    if(error instanceof ProviderVerificationError||error instanceof ChainExtension||/disagree|Tip changed|mismatch/i.test(String(error)))throw error;
    let rejected=0;
    for(const coin of candidate)try{await verifyCoinsAcrossPeers(this.provider,[coin.utxo],this.progress);}catch(reason){
     if(reason instanceof ProviderVerificationError||reason instanceof ChainExtension||/disagree|Tip changed|mismatch/i.test(String(reason)))throw reason;
     excluded.set(coin.utxo.txid+':'+coin.utxo.vout,String(reason));rejected++;
    }
    if(!rejected)throw Error('Selected inputs cannot be verified together: '+String(error));
   }
  }
  return false;
 },this.progress);
 const unsigned=new Set(journal.filter(o=>!reservesFunding(o)).flatMap(o=>o.plan?planCoins(o.plan).map(u=>u.txid+':'+u.vout):[]));
 const report=fundingReport(inventory.coins,inventory.queried,reserved,unsigned,asset.kind==='token'?asset.category:undefined,v3Network(this.provider));report.milliseconds=inventory.milliseconds;
 const unsupportedCondition=(coin:WalletCoin)=>/immature|non-final|relative.lock|budget|depth limit/i.test(excluded.get(coin.utxo.txid+':'+coin.utxo.vout)??'');
 const excludedValue=(condition:(coin:WalletCoin)=>boolean)=>inventory.coins.filter(c=>excluded.has(c.utxo.txid+':'+c.utxo.vout)&&condition(c)).reduce((n,c)=>n+c.utxo.satoshis,0n);
 report.unsupportedConditions=excludedValue(unsupportedCondition).toString();report.ancestryExcluded=excludedValue(c=>!unsupportedCondition(c)).toString();
 report.available=(BigInt(report.available)-BigInt(report.ancestryExcluded)-BigInt(report.unsupportedConditions)).toString();report.availableInputs-=excluded.size;
 let mode:'direct'|'chained'='direct',selected:WalletCoin[];
 try{try{selected=selectDirect(inventory.coins);}catch{selected=selectChained(inventory.coins);mode='chained';}}
 catch(error){
  report.reason=error instanceof FundingSelectionError?error.code:'unsupported';
  if(error instanceof FundingSelectionError)report.required=error.required?.toString();
  this.onFundingReport(report);
  if(excluded.size)throw Error(`Wallet funds found: ${report.total} BCH satoshis, ${report.available} available; ${BigInt(report.ancestryExcluded)+BigInt(report.unsupportedConditions)} excluded because input status, maturity or ancestry could not be verified. ${[...new Set(excluded.values())].join('; ')}`);
  if(BigInt(report.reserved)>0n)throw Error(`Wallet funds found: ${report.total} BCH satoshis, ${report.available} available, ${report.reserved} reserved by an unresolved transaction. Reconcile it in Transaction recovery. ${String(error)}`);
  if(report.total==='0')throw Error(`No eligible BCH found on ${report.addressesQueried} checked wallet addresses. Compare the first receiving address with Cashonize, then search more addresses if needed.`);
  throw error;
 }
 report.selectedInputs=selected.length;report.reason='selected';this.onFundingReport(report);
 this.progress(mode==='direct'?'Constructing direct genesis…':'Constructing covenant-controlled preparation…');
 const op:Operation={id:crypto.randomUUID(),version:3,kind:'create',creationMode:mode,parameters,owner,step:mode==='direct'?'action':'action',stage:'review',signing:'unsigned',plan:await timed(this.provider,'transaction-construction',async()=>mode==='direct'?directPlan(parameters,selected,this.provider):chainedPlan(parameters,selected,owner,this.provider))};
 if(encodeTransaction(op.plan!.request.transaction as Transaction).length>FUNDING_BYTE_BUDGET)throw Error('Funding transaction exceeds its 10,000-byte fee budget; fewer inputs are required.');
 this.progress('Verifying BCH inputs… Checking unconfirmed ancestry…');
 try{if(verifiedSelection!==identity(selected))await verifyCoinsAcrossPeers(this.provider,selected.map(c=>c.utxo),this.progress);}
 catch(error){report.ancestryExcluded=selected.reduce((n,c)=>n+c.utxo.satoshis,0n).toString();report.available='0';report.reason='verification-failed';this.onFundingReport(report);throw Error('Wallet funds were discovered, but selected inputs could not be verified (conflict, ancestry, maturity or provider status). '+String(error));}
 report.verification='selected-inputs-verified';this.onFundingReport(report);await this.store.save(op);return op;
 }
 async createLegacy(parameters:Parameters,keys:WalletKey[]){
 parameters={...parameters,discovery:1};validateParameters(parameters);return this.prepare({kind:'create',parameters},keys);}
 private checkDirect(op:Operation){
 if(!op.plan||op.kind!=='create'||op.creationMode!=='direct'||op.step!=='action')throw Error('Invalid direct creation journal');
 const coins=planCoins(op.plan).map((u,index)=>{const path=op.plan!.inputPaths.find(p=>p[0]===index),publicKey=op.plan!.signers[index];if(!path||!publicKey)throw Error('Missing genesis wallet signer');return {utxo:u,publicKey,path:path[1],index:path[2]};});
 for(const c of coins)if(c.utxo.lockingBytecode!==walletScript(c.publicKey))throw Error('Genesis wallet source mismatch');
 const expected=directPlan(op.parameters,coins,this.provider);
 if(walletPlanIdentity(expected)!==walletPlanIdentity(op.plan))throw Error('Saved genesis changes funding, reserve, category, state or wallet change');
 return expected;
 }
 private checkChained(op:Operation){
 if(!op.plan||op.kind!=='create'||op.creationMode!=='chained'||op.step!=='action')throw Error('Invalid chained creation journal');
 const coins=planCoins(op.plan).map((u,index)=>{const path=op.plan!.inputPaths.find(p=>p[0]===index),publicKey=op.plan!.signers[index];if(!path||!publicKey)throw Error('Missing chained wallet signer');return {utxo:u,publicKey,path:path[1],index:path[2]};});
 for(const c of coins)if(c.utxo.lockingBytecode!==walletScript(c.publicKey))throw Error('Chained wallet source mismatch');
 const expected=chainedPlan(op.parameters,coins,op.owner,this.provider);
 if(walletPlanIdentity(expected)!==walletPlanIdentity(op.plan))throw Error('Saved chained parent changes funding, reserve, covenants or wallet change');
 validateFundingPlan(op,this.provider);return expected;
 }
 /** Build the permissionless child from a signed parent. No wallet signature is required. */
 buildChainedChild(op:Operation,parentRaw:string){
  if(op.kind!=='create'||op.creationMode!=='chained')throw Error('Not a chained creation');
  const parent=decodeTransaction(hexToBin(parentRaw));if(typeof parent==='string')throw Error('Malformed chained parent');
  const parentId=hashTransaction(hexToBin(parentRaw));
  const out=(vout:number):SpendableUtxo=>{const o=parent.outputs[vout]!;return {txid:parentId,vout,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount,...(o.token.nft?{nft:{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})};};
  const built=chainedChildBuilder(op.parameters,out(0),out(1),hexToBin(op.owner.publicKey),this.provider),raw=built.builder.build();
  validateGenesis(op.parameters,raw,[out(0),out(1)],this.provider);
  const sources=[out(0),out(1)].map(u=>({valueSatoshis:u.satoshis,lockingBytecode:hexToBin(u.lockingBytecode!),...(u.token?{token:{category:hexToBin(u.token.category),amount:u.token.amount,...(u.token.nft?{nft:{capability:u.token.nft.capability,commitment:hexToBin(u.token.nft.commitment)}}:{})}}:{})}));
  const decoded=decodeTransaction(hexToBin(raw));if(typeof decoded==='string')throw Error(decoded);
  const valid=createVirtualMachineBch2026().verify({transaction:decoded,sourceOutputs:sources});if(valid!==true)throw Error('Chained child covenant invalid: '+valid);
  return {raw,txid:hashTransaction(hexToBin(raw)),category:built.category,parentId};
 }
 async offer(config:Config,terms:Terms,keys:WalletKey[]){validateNewOffer(config,terms);if(config.registryVersion===4)return this.prepareAtomicOffer(config,terms,keys);return this.prepare({kind:'offer',offerPolicy:'single-win',parameters:config,config,terms},keys);}
 private async prepareAtomicOffer(config:Config,terms:Terms,keys:WalletKey[]){
 const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Receive child zero required');
 this.progress('Verifying vault state…');const snapshot=await new AssetIndexer(this.provider,config).sync();validateIntent({kind:'offer',parameters:config,terms},owner,snapshot);
 const reserved=new Set((await this.store.list()).filter(reservesFunding).flatMap(fundingOutpoints));
 const select=(all:WalletCoin[])=>selectAtomicFunding(all.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout)),config.stakingAsset,terms.stake);
 const inventory=await discoverFunding(this.provider,keys,coins=>{try{select(coins);return true;}catch{return false;}},this.progress),coins=select(inventory.coins);
 this.progress('Constructing atomic offer…');const reviewed=await timed(this.provider,'transaction-construction',async()=>this.atomicPlan(snapshot,terms,owner,coins));
 const op:Operation={id:crypto.randomUUID(),version:3,kind:'offer',registrationMode:'atomic',offerPolicy:'single-win',parameters:config,config,terms,owner,source:snapshot.instance.inputs[0].txid,step:'action',stage:'review',signing:'unsigned',plan:reviewed};
 // Discovery and replay establish the review. Authorize independently verifies all
 // selected sources immediately before signing; avoid duplicating that check here.
 await this.store.save(op);return op;
 }
 private atomicPlan(snapshot:Snapshot,terms:Terms,owner:WalletKey,coins:WalletCoin[]){
 const built=atomicOfferBuilder(snapshot.instance,terms,hexToBin(owner.publicKey),coins,this.provider,snapshot.clock,placeholderSignature());
 const reviewed=plan(built.builder,`Register atomic offer: stake ${terms.stake} ${snapshot.config.stakingAsset.kind} raw units; duration ${terms.duration} seconds; reward ${terms.reward} ${snapshot.config.rewardAsset.kind} raw units; priority ${terms.stake*BigInt(terms.duration)}/${terms.reward}; one miner fee ${FEE} sats; BCH change ${built.bchChange} sats; token change ${built.tokenChange} raw units${built.tokenChange>0n?'; token change carrier 1000 sats':''}`,coins.map((coin,i)=>({coin,index:i+3})),owner);
 if(encodeTransaction(reviewed.request.transaction as Transaction).length>FUNDING_BYTE_BUDGET)throw Error('Atomic offer exceeds its 10,000-byte fee budget');return reviewed;
 }
 private async checkAtomic(op:Operation){
 if(op.kind!=='offer'||op.registrationMode!=='atomic'||!op.config||!op.terms||!op.plan||op.step!=='action')throw Error('Invalid atomic offer journal');
 const snapshot=await new AssetIndexer(this.provider,op.config).sync();validateIntent(op,op.owner,snapshot);
 if(snapshot.instance.inputs[0].txid!==op.source)throw Error('Vault state changed; reconcile retained transactions in Transaction recovery before explicitly reviewing a new offer. Signed evidence must be retained.');
 const coins=planCoins(op.plan).slice(3).map((utxo,n)=>{const i=n+3,path=op.plan!.inputPaths.find(p=>p[0]===i),publicKey=op.plan!.signers[i];if(!path||!publicKey)throw Error('Missing atomic funding signer');return {utxo,publicKey,path:path[1],index:path[2]};});
 const expected=this.atomicPlan(snapshot,op.terms,op.owner,coins);
 if(walletPlanIdentity(expected)!==walletPlanIdentity(op.plan))throw Error('Saved atomic offer differs from reviewed terms, state, funding or change');return expected;
 }
 private async resumeAtomic(op:Operation){
 if(!op.raw||!op.txid){await this.checkAtomic(op);return op;}
 try{const snapshot=await new AssetIndexer(this.provider,op.config!).sync();
 const next=reconcileAtomicOffer(op,snapshot);await this.store.save(next);return next;
 }catch(e){const next:Operation={...op,step:'action',stage:'prepared',confirmations:0,observation:'unavailable',error:'Status unavailable; signed bytes retained: '+String(e)};await this.store.save(next);return next;}
 }
 async action(config:Config,action:number,slot:number,keys:WalletKey[]){if(action===3)return this.claim(config,keys);if(![1,4].includes(action))throw Error('Invalid v3 action');return this.prepare({kind:'action',parameters:config,config,action,slot},keys);}
 async withdraw(config:Config,allocation:string,keys:WalletKey[]){return this.prepare({kind:'withdraw',parameters:config,config,allocation},keys);}
 /** One approval, one transaction. The caller need not own any offer. */
 async claim(config:Config,keys:WalletKey[]){
  const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Connect a compatible wallet with receive child zero');
  const snapshot=await new AssetIndexer(this.provider,config).sync(),next=decision(snapshot.instance,snapshot.clock);
  if(snapshot.pending.length)throw Error('A competing vault transaction is pending; refresh before claiming');
  if(next.phase!=='ready')throw Error(next.reason);
  const journal=await this.store.list();
  if(journal.some(o=>o.kind==='claim'&&o.config?.genesis===config.genesis&&o.step!=='complete'&&!snapshot.history.includes(o.txid??'')&&!(snapshot.pendingHistory??[]).includes(o.txid??'')))throw Error('An existing claim needs reconciliation or explicit discard before another spend');
  const reserved=new Set(journal.filter(reservesFunding).flatMap(o=>o.plan?planCoins(o.plan).map(i=>i.txid+':'+i.vout):[]));
  const required=sponsorAmount(snapshot.instance,3);
 const eligible=(coins:WalletCoin[])=>coins.filter(c=>!c.utxo.token&&!reserved.has(c.utxo.txid+':'+c.utxo.vout)&&(c.utxo.satoshis===required||c.utxo.satoshis>=required+CARRIER));
 const inventory=await discoverFunding(this.provider,keys,coins=>eligible(coins).length>0,this.progress);
  const coin=inventory.coins.filter(c=>!c.utxo.token&&!reserved.has(c.utxo.txid+':'+c.utxo.vout)&&(c.utxo.satoshis===required||c.utxo.satoshis>=required+CARRIER)).sort((a,b)=>a.utxo.satoshis<b.utxo.satoshis?-1:a.utxo.satoshis>b.utxo.satoshis?1:0)[0];
  if(!coin)throw Error(`Insufficient BCH: one verified token-free wallet coin must cover ${required} satoshis (miner fee ${FEE}, token carriers ${required-FEE}), with exact funding or at least 1000 satoshis change`);
  const clock=await verifyCoinsAcrossPeers(this.provider,[...snapshot.instance.inputs,coin.utxo],this.progress);
  if(clock.hash!==snapshot.tip.hash)throw Error('Chain changed during fee selection; refresh before authorizing');
  const built=transitionBuilder(snapshot.instance,3,next.slot,this.provider,clock,sponsor(coin,coin.utxo,this.provider),undefined,undefined,{address:ownerAddress(hexToBin(coin.publicKey),this.provider)});
  const op:Operation={id:crypto.randomUUID(),version:3,kind:'claim',parameters:config,config,action:3,slot:next.slot,owner,payer:{publicKey:coin.publicKey,path:coin.path,index:coin.index},source:snapshot.instance.inputs[0].txid,step:'action',stage:'review',signing:'unsigned',plan:plan(built.builder,`Claim reward to top offer #${next.slot}; caller pays miner fee ${FEE} sats + token carriers ${required-FEE} sats; change ${coin.utxo.satoshis-required} sats; no caller reward`,[{coin,index:3}])};
  await this.store.save(op);return op;
 }
 private async checkClaim(op:Operation){
  if(!op.config||!op.plan||!op.payer||op.source===undefined||op.slot===undefined||op.step!=='action')throw Error('Invalid saved claim');
  if(op.plan.request.broadcast!==false)throw Error('Saved claim must disable wallet broadcasting');
  const snapshot=await new AssetIndexer(this.provider,op.config).sync();
  validateIntent(op,op.owner,snapshot);
  if(snapshot.instance.inputs[0].txid!==op.source)throw Error('Claim state changed; reconcile the conflicting claim');
  const coins=planCoins(op.plan),tx=op.plan.request.transaction as Transaction;
  if(coins.length!==4||coins[3]!.token||coins[3]!.lockingBytecode!==walletScript(op.payer.publicKey))throw Error('Invalid caller BCH input');
  const built=transitionBuilder(snapshot.instance,3,op.slot,this.provider,{height:snapshot.clock.height,mtp:tx.locktime+1},sponsor(op.payer,coins[3]!,this.provider),undefined,undefined,{address:ownerAddress(hexToBin(op.payer.publicKey),this.provider)});
  const expected=plan(built.builder,op.plan.label,[{coin:keyCoin(op.payer,coins[3]!),index:3}]);
  if(walletPlanIdentity(op.plan)!==walletPlanIdentity(expected))throw Error('Saved claim changes the winner, fee, carriers, inputs or caller change');
  // The identity deliberately excludes WalletConnect metadata. Only freshly generated
  // source witnesses/contract descriptions may cross the wallet authorization boundary.
  return expected;
 }
 private async resumeClaim(op:Operation){
  if(op.raw&&op.txid){
   try{const s=await new AssetIndexer(this.provider,op.config!).sync();
    const confirmed=s.history.includes(op.txid),pending=s.pending.includes(op.txid)||(s.pendingHistory??[]).includes(op.txid),conflict=!confirmed&&!pending&&s.instance.inputs[0].txid!==op.source;
    const next:Operation={...op,step:confirmed||conflict?'complete':'action',stage:confirmed?'confirmed':pending?'pending':conflict?'conflicted':'prepared',error:conflict?'A competing confirmed claim/state spend superseded this transaction':confirmed?undefined:'Signed transaction retained; only an explicit identical-byte retry is permitted'};
    await this.store.save(next);return next;
   }catch(e){const next:Operation={...op,step:'action',stage:'prepared',error:'Confirmation unavailable; signed claim retained: '+String(e)};await this.store.save(next);return next;}
  }
  if(op.step==='complete')return op;
  try{await this.checkClaim(op);return op;}catch(e){const next:Operation={...op,error:'Unsigned claim needs refresh/discard: '+String(e)};await this.store.save(next);throw e;}
 }
 private async prepare(request:Pick<Operation,'kind'|'parameters'> & Partial<Operation>,keys:WalletKey[]){
 const owner=keys.find(k=>k.path==='receive'&&k.index===0);if(!owner)throw Error('Receive child zero required');
 const snapshot=request.config?await new AssetIndexer(this.provider,request.config).sync():undefined;
 if(snapshot)validateIntent(request,owner,snapshot);
 const journal=await this.store.list(),reserved=new Set(journal.filter(reservesFunding).flatMap(o=>o.plan?.request.transaction.inputs.map(i=>Buffer.from(i.outpointTransactionHash).toString('hex')+':'+i.outpointIndex)??[]));
 let asset:Asset={kind:'bch'},amount=0n,base=0n,extra=FEE;
 if(request.kind==='create'){asset=request.parameters.rewardAsset;amount=request.parameters.cap*BigInt(request.parameters.periods);base=CARRIER;extra=12000n;}
 else if(request.kind==='offer'){asset=request.parameters.stakingAsset;amount=validateTerms(request.parameters,request.terms!);base=asset.kind==='token'?CARRIER:0n;extra=sponsorAmount(snapshot!.instance,0);}
 else {
  extra=request.kind==='withdraw'?FEE:sponsorAmount(snapshot!.instance,request.action!);
 }
 const required=(request.kind==='create'&&request.parameters.discovery===1?DISCOVERY_CARRIER:0n)+base+(asset.kind==='bch'?amount:0n)+extra+FEE+CARRIER+(asset.kind==='token'?CARRIER:0n);
 const select=(found:WalletCoin[])=>{const coins=found.filter(c=>!reserved.has(c.utxo.txid+':'+c.utxo.vout));return chooseBch(coins,required,asset.kind==='token'?chooseTokens(coins,asset.category,amount):[]);};
 const inventory=await discoverFunding(this.provider,keys,coins=>{try{select(coins);return true;}catch{return false;}},this.progress),selected=select(inventory.coins);
 const total=selected.reduce((n,c)=>n+c.utxo.satoshis,0n),tokens=selected.reduce((n,c)=>n+(c.utxo.token?.amount??0n),0n),builder=new TransactionBuilder({provider:this.provider});
 for(const c of selected)builder.addInput(c.utxo,placeholderP2PKHUnlocker(ownerAddress(hexToBin(c.publicKey),this.provider)));
 let sent=extra;
 if(request.kind==='create'){const factory=covenant(request.parameters.registryVersion===4?'RegistryAtomicGenesisV4':'RegistryGenesisV3',parameterArgs(request.parameters),this.provider);builder.addOutput({to:factory.address,amount:12000n}).addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),...assetOutput(asset,amount,base)});sent+=base+(asset.kind==='bch'?amount:0n);addAnnouncement(builder,request.parameters,'parent',this.provider);if(request.parameters.discovery===1)sent+=DISCOVERY_CARRIER;}
 else if(request.kind==='offer'){builder.addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),...assetOutput(asset,amount,base)}).addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),amount:extra});sent+=base+(asset.kind==='bch'?amount:0n);}
 else builder.addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),amount:extra});
 const tokenChange=asset.kind==='token'&&tokens>amount;
 if(tokenChange&&asset.kind==='token')builder.addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),amount:CARRIER,token:{category:asset.category,amount:tokens-amount}});
 builder.addOutput({to:ownerAddress(hexToBin(owner.publicKey),this.provider),amount:total-sent-FEE-(tokenChange?CARRIER:0n)});
 const op:Operation={...request,...(snapshot?{source:intentSource(request,snapshot)}:{}),id:crypto.randomUUID(),version:3,kind:request.kind,parameters:request.parameters,owner,step:'funding',stage:'review',signing:'unsigned',plan:plan(builder,`Prepare ${request.kind}: ${amount} ${asset.kind} raw units; external BCH funding ${extra}; fee ${FEE}`,selected.map((coin,index)=>({coin,index})))};
 this.progress('Verifying BCH inputs… Checking unconfirmed ancestry…');await verifyCoinsAcrossPeers(this.provider,selected.map(c=>c.utxo),this.progress);await this.store.save(op);return op;
 }
 async resume(id:string){let op=(await this.store.list()).find(o=>o.id===id);if(!op)throw Error('Unknown v3 operation');
 if(op.registrationMode==='atomic')return this.resumeAtomic(op);
 if(op.kind==='claim')return this.resumeClaim(op);
 if(op.creationMode==='direct'||op.creationMode==='chained')return this.resumeDirect(op);
 if(op.raw&&op.txid){let status:any;
 try{status=await confirmedWalletTransaction(this.provider,op.txid);}catch(e){const uncertain={...op,step:op.step==='complete'?'action' as const:op.step,stage:'prepared' as const,error:'Confirmation unavailable; signed transaction retained: '+String(e)};await this.store.save(uncertain);return uncertain;}
 if(status.confirmations<=0&&op.step!=='funding'){const pending={...op,step:op.step==='complete'?'action' as const:op.step,stage:'pending' as const,error:'Pending (0-conf); provisional until canonical confirmation',...(op.kind==='create'?{config:{...op.parameters,genesis:op.txid}}:{})};await this.store.save(pending);return pending;}
 if(op.step==='action'||op.step==='complete'){op={...op,step:'complete',stage:'confirmed',config:op.kind==='create'?{...op.parameters,genesis:op.txid}:op.config};await this.store.save(op);return op;}
 op={...op,funding:op.txid,fundingRaw:op.raw,fundingPlan:op.plan,stage:'confirmed',raw:undefined,txid:undefined,plan:undefined};await this.store.save(op);
 }
 if(op.step==='complete'||(op.plan&&op.step==='funding'))return op;
 // Unsigned action plans are rebuilt from freshly verified sources before each approval.
 if(op.plan){op={...op,plan:undefined,stage:'confirmed'};await this.store.save(op);}
 if(!op.funding)throw Error('Missing verified funding');
 const funding=await confirmedWalletTransaction(this.provider,op.funding);await verifyCoinsAcrossPeers(this.provider,[utxo(funding,0),...(op.kind==='create'||op.kind==='offer'?[utxo(funding,1)]:[])],this.progress);
 let builder:TransactionBuilder,mapping:{coin:WalletCoin;index:number}[]=[],auth:WalletKey|undefined;
 const coin=(n:number)=>keyCoin(op!.owner,utxo(funding,n));
 if(op.kind==='create'){builder=genesisBuilder(op.parameters,utxo(funding,0),sponsor(op.owner,utxo(funding,1),this.provider),this.provider).builder;mapping=[{coin:coin(1),index:1}];}
 else {const snapshot=await new AssetIndexer(this.provider,op.config!).sync();validateIntent(op,op.owner,snapshot);op={...op,source:intentSource(op,snapshot)};
 if(op.kind==='withdraw'){const a=snapshot.allocations.find(a=>a.id===op!.allocation);if(!a||!a.mature||a.withdrawal||a.pending||a.terms.subarray(0,33).toString('hex')!==op.owner.publicKey)throw Error('Allocation unavailable, immature, or not owned');builder=withdrawalBuilder(a.input,a.terms,placeholderSignature(),sponsor(op.owner,coin(0).utxo,this.provider),this.provider);mapping=[{coin:coin(0),index:1}];auth=op.owner;}
 else {const registration=op.kind==='offer'?{owner:hexToBin(op.owner.publicKey),terms:op.terms!,funding:sponsor(op.owner,coin(0).utxo,this.provider)}:undefined,action=op.kind==='offer'?0:op.action!,slot=op.kind==='offer'?snapshot.instance.state[5]!:op.slot??0;
 const built=transitionBuilder(snapshot.instance,action,slot,this.provider,snapshot.clock,sponsor(op.owner,coin(op.kind==='offer'?1:0).utxo,this.provider),[0,1,4].includes(action)?placeholderSignature():undefined,registration);builder=built.builder;
 mapping=op.kind==='offer'?[{coin:coin(0),index:3},{coin:coin(1),index:4}]:[{coin:coin(0),index:3}];if([0,1,4].includes(action))auth=op.owner;
 }}
 op={...op,step:'action',stage:'review',signing:'unsigned',plan:plan(builder,`${op.kind} v3: ${JSON.stringify(op.parameters,(_,v)=>typeof v==='bigint'?v.toString():v)}`,mapping,auth)};await this.store.save(op);return op;
 }
 private async resumeDirect(op:Operation){
 if(!op.raw||!op.txid){if(op.step!=='complete'){if(op.creationMode==='chained')this.checkChained(op);else this.checkDirect(op);}return op;}
 try{const status=await confirmedWalletTransaction(this.provider,op.txid);if(status.hex!==op.raw)throw Error('Saved genesis bytes mismatch');
 const confirmed=status.confirmations>0,next:Operation={...op,step:confirmed?'complete':'action',stage:confirmed?'confirmed':'pending',confirmations:status.confirmations,error:undefined,config:{...op.parameters,genesis:op.txid}};await this.store.save(next);return next;
 }catch(e){
 const conflict=op.creationMode==='chained'?undefined:await this.directConflict(op).catch(()=>undefined);
 const next:Operation={...op,step:'action',stage:conflict?'conflicted':'prepared',error:(conflict?'Known conflicting transaction '+conflict+'. ':'')+'Status unavailable, dropped, conflicting or reorganized; saved bytes retained. Reconcile or explicitly retry identical transaction: '+String(e)};await this.store.save(next);return next;
 }
 }
 private async directConflict(op:Operation){
 const inputs=planCoins(op.plan!),conflicts:string[]=[];
 for(const peer of walletPeers(this.provider)){
 const id=await this.provider.session(async()=>{
 for(const script of new Set(inputs.map(i=>i.lockingBytecode!)))for(const h of await this.provider.history(script)){
 if(h.tx_hash===op.txid)continue;
 const tx=await this.provider.transactionStatus(h.tx_hash);
 if(tx.vin.some((i:any)=>inputs.some(input=>i.txid===input.txid&&i.vout===input.vout)))return h.tx_hash;
 }
 return undefined;
 },peer);if(!id)return undefined;conflicts.push(id);
 }
 return conflicts[0]===conflicts[1]?conflicts[0]:undefined;
 }
 private async checkIntent(op:Operation){
  if(!op.config||op.kind==='claim'||op.kind==='create')return;
  const snapshot=await new AssetIndexer(this.provider,op.config).sync();
  validateIntent(op,op.owner,snapshot);
  if(op.source!==undefined&&op.source!==intentSource(op,snapshot))throw Error('Vault state changed since preparation. Reconcile retained transactions in Transaction recovery before reviewing a new transaction with explicit wallet approval. Signed evidence must be retained.');
 }
 /** Read-only pre-approval validation. Never signs, sends or replaces a funding transaction. */
 async authorize(id:string){
 return timed(this.provider,'pre-approval-revalidation',async()=>{
 const op=(await this.store.list()).find(o=>o.id===id);
 if(!op?.plan||op.stage!=='review'||op.raw||op.txid)throw Error('V3 operation is not awaiting unsigned wallet approval');
 if(op.registrationMode!=='atomic')await this.checkIntent(op);
 validateParameters(op.parameters);validateFundingPlan(op,this.provider);const authorizedPlan=op.registrationMode==='atomic'?await this.checkAtomic(op):op.creationMode==='direct'?this.checkDirect(op):op.creationMode==='chained'?this.checkChained(op):op.kind==='claim'?await this.checkClaim(op):op.plan;
 const own=new Set(planCoins(op.plan).map(u=>u.txid+':'+u.vout));
 const journal=await this.store.list();
 if(journal.some(other=>other.id!==op.id&&reservesFunding(other)&&fundingOutpoints(other).some(id=>own.has(id))))throw Error('Wallet funds are reserved by another unresolved transaction; reconcile before approval.');
 await verifyCoinsAcrossPeers(this.provider,planCoins(op.plan),this.progress);
 await this.store.save({...op,signing:'requested'});
 return {plan:authorizedPlan,owner:op.owner,verifiedAt:Date.now()};
 });
 }
 async signingFailed(id:string,error:string,rejected=false){const op=(await this.store.list()).find(o=>o.id===id);if(!op||op.raw||op.txid)return op;const next={...op,signing:rejected?'rejected' as const:op.signing,error:'Wallet authorization interrupted or refused: '+error.slice(0,500)};await this.store.save(next);return next;}
 async rebroadcastFunding(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op?.fundingRaw||!op.fundingPlan)throw Error('No saved signed funding transaction');
 validateFundingPlan({...op,step:'funding',plan:op.fundingPlan},this.provider);const inputs=planCoins(op.fundingPlan),clock=await verifyCoinsAcrossPeers(this.provider,inputs,this.progress);validateWalletSigned(op.fundingPlan,op.fundingRaw,clock);
 await this.provider.session(async()=>{await verifyCoinsAcrossPinned(this.provider,inputs,clock.hash);await this.provider.sendRawTransaction(op.fundingRaw!);},clock.peer);
 const pending={...op,stage:'pending' as const,error:'Identical funding transaction retried; reconcile provider acceptance before continuing (no block required)'};await this.store.save(pending);return pending;
 }
 async rebroadcast(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op?.raw||!op.plan||!op.txid||op.step==='complete')throw Error('No uncertain signed transaction');
 if(op.registrationMode==='atomic'){const checked=await this.resumeAtomic(op);if(['confirmed','pending','conflicted'].includes(checked.stage))return checked;}
 if(op.creationMode==='direct'||op.creationMode==='chained'){const checked=await this.resumeDirect(op);if(checked.stage==='confirmed'||checked.stage==='pending')return checked;}
 if(op.kind==='claim'){const checked=await this.resumeClaim(op);if(checked.stage==='confirmed'||checked.stage==='conflicted'||checked.stage==='pending')return checked;}
 if(op.creationMode==='chained'&&op.fundingRaw&&op.childRaw){
  const clock=await verifyCoinsAcrossPeers(this.provider,planCoins(op.plan),this.progress);
  try{await this.provider.session(async()=>{await this.provider.sendRawTransaction(op.fundingRaw!);await this.provider.sendRawTransaction(op.childRaw!);},clock.peer);const sent={...op,stage:'pending' as const,error:undefined,confirmations:0};await this.store.save(sent);return sent;}catch(e){const uncertain={...op,error:String(e)};await this.store.save(uncertain);return uncertain;}
 }
 const reviewed={...op,stage:'review' as const};await this.store.save(reviewed);return this.submit(id,op.raw);
 }
 async discard(id:string){const op=(await this.store.list()).find(o=>o.id===id);if(!op||op.raw||op.txid)throw Error('Only unsigned operations may be discarded');if(op.kind==='create'&&op.funding)throw Error('A funded factory must remain recoverable; finish genesis instead of discarding it');const discarded={...op,step:'complete' as const,stage:op.kind==='claim'?'conflicted' as const:'confirmed' as const,plan:undefined,error:'Unsigned operation discarded; prepared wallet coins remain spendable'};await this.store.save(discarded);return discarded;}
 /** Persist a returned signature before session/state checks; this method never broadcasts. */
 async retainAtomicSigned(id:string,raw:string){
 const op=(await this.store.list()).find(o=>o.id===id);
 if(!op?.plan||op.registrationMode!=='atomic'||op.step!=='action'||op.stage==='conflicted'||op.raw&&op.raw!==raw)throw Error('No matching atomic authorization to retain');
 // This retention check verifies shape, signatures and covenants, without network I/O.
 // Fresh chain finality and input availability are checked by submit before broadcasting.
 const signed=validateWalletSigned(op.plan,raw,{height:0xffffffff,mtp:0xffffffff},v3WalletValidation);
 const retained:Operation={...op,raw,txid:signed.txid,stage:'prepared',error:'Signed atomic transaction retained; current state must be verified before broadcast'};
 await this.store.save(retained);return retained;
 }
 /** Save valid signatures without network I/O, including a recoverable chained child. */
 async retainSigned(id:string,raw:string){
 const op=(await this.store.list()).find(o=>o.id===id);
 if(op?.registrationMode==='atomic')return this.retainAtomicSigned(id,raw);
 if(!op?.plan||op.stage!=='review'||op.raw&&op.raw!==raw)throw Error('No matching reviewed authorization');
 const signed=validateWalletSigned(op.plan,raw,{height:0xffffffff,mtp:0xffffffff},v3WalletValidation);
 if(op.creationMode==='chained'){
  const child=this.buildChainedChild(op,raw);
  const retained:Operation={...op,fundingRaw:raw,funding:child.parentId,fundingPlan:op.plan,childRaw:child.raw,raw:child.raw,txid:child.txid,stage:'prepared',config:{...op.parameters,genesis:child.txid}};
  await this.store.save(retained);return retained;
 }
 const retained:Operation={...op,raw,txid:signed.txid,stage:'prepared',...(op.kind==='create'&&op.step==='action'?{config:{...op.parameters,genesis:signed.txid}}:{})};
 await this.store.save(retained);return retained;
 }
 async submit(id:string,raw:string){const op=(await this.store.list()).find(o=>o.id===id);
 const saved=op?.creationMode==='chained'?op.fundingRaw:op?.raw;
 if(!op?.plan||(op.stage!=='review'&&!(op.stage==='prepared'&&saved===raw)))throw Error('No reviewed v3 plan');
 if(saved&&saved!==raw)throw Error('Only identical saved signed bytes may be retried');
 if(!saved)await this.retainSigned(id,raw);
 if(op.registrationMode!=='atomic')await this.checkIntent(op);
 validateFundingPlan(op,this.provider);if(op.registrationMode==='atomic')op.plan=await this.checkAtomic(op);if(op.kind==='claim')await this.checkClaim(op);if(op.creationMode==='direct')op.plan=this.checkDirect(op);if(op.creationMode==='chained')op.plan=this.checkChained(op);const inputs=planCoins(op.plan);
 const clock=await verifyCoinsAcrossPeers(this.provider,inputs,this.progress),validated=await timed(this.provider,'post-signature-validation',async()=>validateWalletSigned(op.plan!,raw,clock,v3WalletValidation));
 if(op.creationMode==='chained'){
  const child=this.buildChainedChild(op,raw);
  const prepared:Operation={...op,fundingRaw:raw,funding:child.parentId,fundingPlan:op.plan,childRaw:child.raw,raw:child.raw,txid:child.txid,stage:'prepared',config:{...op.parameters,genesis:child.txid}};
  await this.store.save(prepared);this.progress('Broadcasting preparation and permissionless genesis…');
  try{await timed(this.provider,'broadcast',()=>this.provider.session(async()=>{await verifyCoinsAcrossPinned(this.provider,inputs,clock.hash);const parentAccepted=await this.provider.sendRawTransaction(raw);if(parentAccepted!==child.parentId)throw Error('Parent broadcast returned an unexpected transaction ID');const childAccepted=await this.provider.sendRawTransaction(child.raw);if(childAccepted!==child.txid)throw Error('Child broadcast returned an unexpected transaction ID');},clock.peer));
   const sent={...prepared,stage:'pending' as const,confirmations:0};await this.store.save(sent);this.progress('Vault pending (0-conf)');return sent;
  }catch(e){const uncertain={...prepared,error:String(e)};await this.store.save(uncertain);return uncertain;}
 }
 const prepared={...op,raw,txid:validated.txid,stage:'prepared' as const,...(op.kind==='create'&&op.step==='action'?{config:{...op.parameters,genesis:validated.txid}}:{})};if(op.creationMode==='direct')validateGenesis(op.parameters,raw,inputs,this.provider);await this.store.save(prepared);
 this.progress('Broadcasting vault…');
 try {await timed(this.provider,'broadcast',()=>this.provider.session(async()=>{await verifyCoinsAcrossPinned(this.provider,inputs,clock.hash);const accepted=await this.provider.sendRawTransaction(raw);if(accepted!==validated.txid)throw Error('Broadcast returned an unexpected transaction ID');},clock.peer));const sent={...prepared,acceptedAt:Date.now(),observation:'propagating' as const,stage:'pending' as const,...(op.creationMode==='direct'?{confirmations:0}:{})};await this.store.save(sent);this.progress(op.kind==='create'?'Vault pending (0-conf)':'Transaction pending (0-conf)');return sent;}catch(e){const uncertain={...prepared,error:String(e)};await this.store.save(uncertain);return uncertain;}
 }
}
async function verifyCoinsAcrossPinned(p:ElectrumCore,inputs:SpendableUtxo[],hash:string){if((await p.tip()).hash!==hash)throw new ProviderVerificationError('synchronizing');const checked=await verifyCoins(p,inputs,p.endpoint,true);if(checked.hash!==hash)throw new ProviderVerificationError('synchronizing');}
export class BrowserAssetStore implements Store {
 constructor(readonly network:V3Network='regtest'){}
 private db?:Promise<IDBDatabase>;
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(v3Storage('wallet',this.network),1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('V3 journal blocked'));r.onsuccess=()=>resolve(r.result);});}
 async list(){const db=await this.open();return new Promise<Operation[]>((resolve,reject)=>{const t=db.transaction('operations'),r=t.objectStore('operations').getAll();r.onsuccess=()=>{try{for(const row of r.result)assertStoredNetwork(row,this.network);resolve(r.result);}catch(error){reject(error);}};r.onerror=()=>reject(r.error);});}
 async save(op:Operation){if(op.network!==undefined)assertStoredNetwork(op,this.network);op.network=this.network;const db=await this.open();await new Promise<void>((resolve,reject)=>{const t=db.transaction('operations','readwrite',{durability:'strict'});t.objectStore('operations').put(op,op.id);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
}


function v3WalletValidation(raw:string,sources:import('@bitauth/libauth').Output[],clock:import('../keeper-core.js').KeeperClock,fee?:bigint){
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed transaction');
 if(tx.version!==2||tx.locktime>=(tx.locktime<500000000?finalityLimit(clock):clock.mtp))throw Error('Non-final transaction');
 if(sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n)!==fee)throw Error('Fee mismatch');
 const valid=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:sources});if(valid!==true)throw Error('Signed v3 covenant invalid: '+valid);
 return {txid:hashTransaction(hexToBin(raw)),transaction:tx,fee:fee!};
}
