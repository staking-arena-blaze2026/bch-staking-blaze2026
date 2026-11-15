import {assertOfferCutoff} from './offer-policy.js';
import {binToHex,hexToBin,type Transaction} from '@bitauth/libauth';
import {ElectrumCore,decodeRawTransaction} from './electrum-core.js';
import {ElectrumIndexer} from './indexer-core.js';
import {utxo,json,type VaultConfig} from './arena-core.js';
import {verifyRegistryGenesis,type GenesisParameters} from './genesis-core.js';
import {verifyCanonicalVault} from './browser-keeper.js';
import {validateKeeperTransaction,sourceOutput,type KeeperClock} from './keeper-core.js';
import {buildCreatePlan,buildGenesis,buildPreparation,buildRegistration,validateWalletSigned,walletPlanIdentity,type WalletKey,type WalletCoin,type BrowserPlan,walletScript} from './transactions-core.js';
import {scanWallet,chooseBch,chooseTokens,verifyCoinsAcrossPeers,verifyCoins,confirmedWalletTransaction,walletPeers,type WalletInventory} from './electrum-wallet.js';
import {vaultFunding,validateVaultParameters,validateOfferTerms,type OfferTerms} from './wallet-terms.js';
export interface WalletOperation {
 version:1;network:'chipnet';id:string;kind:'create'|'offer';step:'funding'|'genesis'|'preparation'|'register'|'complete';stage:'review'|'ready'|'pending'|'confirmed'|'conflict'|'error'|'cancelled';
 observation?:'submitted'|'unconfirmed'|'confirmed'|'dropped-or-replaced'|'conflicted'|'unavailable'; owner?:WalletKey;change?:WalletKey;parameters:GenesisParameters;config?:VaultConfig;terms?:OfferTerms;coins:WalletCoin[];clock?:KeeperClock;plan?:BrowserPlan;raw?:string;txid?:string;
 pregenesis?:string;preparation?:string;genesis?:string;registration?:string;updatedAt:number;error?:string;
}
export interface WalletOperationStore {list():Promise<WalletOperation[]>;save(operation:WalletOperation):Promise<void>}
const missing=(error:unknown)=>/no such.*transaction|not found|unknown transaction|Transaction status unavailable/i.test(String(error));
export class BrowserWallet {
 inventory?:WalletInventory;
 onOperation?:(op:WalletOperation)=>void;
 onProgress?:(message:string)=>void;
 private keys:WalletKey[]=[];
 constructor(readonly index:ElectrumIndexer,readonly store:WalletOperationStore,readonly now=()=>Date.now()){}
 get provider(){return this.index.electrum!;}
 private validate(op:WalletOperation){
  if(!op||op.version!==1||op.network!=='chipnet'||typeof op.id!=='string'||op.id.length>64||!['create','offer'].includes(op.kind)||!['funding','genesis','preparation','register','complete'].includes(op.step)||!['review','ready','pending','confirmed','conflict','error','cancelled'].includes(op.stage)||!Array.isArray(op.coins)||op.coins.length>8)throw Error('Invalid wallet journal; restore the exported public recovery record');
  validateVaultParameters(op.parameters);
  if(op.kind==='offer'&&(!op.config||!['stakingCategory','epoch','periodSeconds','periods','cap'].every(k=>(op.config as any)[k]===(op.parameters as any)[k])))throw Error('Wallet journal configuration mismatch');
  if(op.raw&&(!op.txid||op.raw.length>200000||decodeRawTransaction(op.raw).txid!==op.txid))throw Error('Invalid signed journal transaction');
  return op;
 }
 private async save(op:WalletOperation){this.validate(op);const existing=await this.store.list();if(existing.length>=64&&!existing.some(o=>o.id===op.id))throw Error('Wallet journal is full; export recovery records before starting another operation');op.updatedAt=this.now();await this.store.save(op);this.onOperation?.(op);return op;}
 private async operation(id:string){const list=await this.store.list();if(list.length>64)throw Error('Wallet operation limit reached');const op=list.find(o=>o.id===id);if(!op||op.version!==1||op.network!=='chipnet'||!['create','offer'].includes(op.kind))throw Error('Unknown or invalid chipnet operation');return this.validate(op);}
 async list(){const list=await this.store.list();if(list.length>64)throw Error("Oversized wallet journal");return list.map(op=>this.validate(op));}
 async scan(keys:WalletKey[]){this.inventory=undefined;this.keys=[];const inventory=await scanWallet(this.provider,keys,{onProgress:this.onProgress});this.keys=keys;this.inventory=inventory;return inventory;}
 private binding(key:WalletKey,keys:WalletKey[]){if(!keys.some(k=>k.publicKey===key.publicKey&&k.path===key.path&&k.index===key.index))throw Error('The connected wallet does not control this operation’s derivation path');}
 private identity(keys:WalletKey[]){const owner=keys.find(k=>k.path==='receive'&&k.index===0),change=keys.find(k=>k.path==='change'&&k.index===0);if(!owner||!change)throw Error('Live wallet receive/change paths are required');return {owner,change};}
 private async freshVault(config:VaultConfig){if(!this.index.configs.some(c=>c.genesis===config.genesis))this.index.configs.push(config);await this.index.sync();const v=this.index.vaults.find(v=>v.config.genesis===config.genesis);if(!v)throw Error('Vault is not confirmed');for(const peer of walletPeers(this.provider))await this.provider.session(()=>verifyCanonicalVault(this.index,this.provider,v),peer);return v;}
 private offerCutoff(config:VaultConfig,clock:KeeperClock&{hash:string}) {
  const vault=this.index.vaults.find(v=>v.config.genesis===config.genesis),tip=this.index.tip;
  if(!vault||!tip||!this.index.health.connected||this.index.health.stale||this.now()-Date.parse(this.index.health.updatedAt)>60000||tip.hash!==clock.hash)throw Error('Fresh, matching two-provider vault verification is required for an offer');
  const state=hexToBin(vault.witness);return assertOfferCutoff(config,new DataView(state.buffer,state.byteOffset).getUint32(0,true),!!state[4],state[5],this.now()/1000,clock.mtp);
 }
 private async eligibleVault(config:VaultConfig) {
  const vault=await this.freshVault(config),tip=this.index.tip!;
  this.offerCutoff(config,{height:tip.height,mtp:tip.mtp,hash:tip.hash});
  return vault;
 }
 /** Fresh authorization immediately before the live wallet signing request. No signing occurs here. */
 async authorize(id:string,keys:WalletKey[]) {
  const op=await this.operation(id);if(op.stage!=='review'||!op.plan)throw Error('Operation is not ready for wallet approval');
  const canonical=await this.canonicalPlan(op,keys,op.clock!);
  if(walletPlanIdentity(canonical)!==walletPlanIdentity(op.plan))throw Error('Canonical plan changed; rebuild before wallet approval');
  const clock=await verifyCoinsAcrossPeers(this.provider,op.coins.map(c=>c.utxo));
  const transaction=canonical.request.transaction as Transaction;
  if(transaction.locktime>=(transaction.locktime<500000000?clock.height+1:clock.mtp))throw Error('Wallet plan is not final at the freshly verified chain clock; rebuild before signing');
  const deadline=op.kind==='offer'?this.offerCutoff(op.config!,clock):undefined;
  return {deadline,verifiedAt:this.now()};
 }
 private async canonicalPlan(op:WalletOperation,keys:WalletKey[],clock:KeeperClock) {
  if(!op.owner||!op.change)throw Error('Wallet identity required');this.binding(op.owner,keys);this.binding(op.change,keys);for(const c of op.coins)this.binding(c,keys);
  if(op.step==='funding')return buildCreatePlan(op.parameters,op.coins,op.change,this.provider);
  if(op.step==='preparation'){await this.eligibleVault(op.config!);return buildPreparation(op.coins,op.owner,op.change,op.parameters.stakingCategory,validateOfferTerms(op.parameters,op.terms!),this.provider);}
  if(op.step==='register') {
   const vault=await this.eligibleVault(op.config!);
   if(op.raw&&op.plan) {const tx=op.plan.request.transaction as Transaction;if(binToHex(tx.inputs[0].outpointTransactionHash)!==vault.transaction.txid)throw Error('Registration conflict: another confirmed state spend won. Rebuild and approve a fresh transaction.');}
   return buildRegistration(vault,op.coins[0],op.owner,op.terms!,this.provider,clock);
  }
  throw Error('Operation has no wallet signing step');
 }
 private async availableCoins(){
  const reserved=new Set((await this.store.list()).filter(o=>o.step!=='complete'&&o.stage!=='cancelled').flatMap(o=>o.coins.map(c=>c.utxo.txid+':'+c.utxo.vout)));
  return this.inventory!.coins.filter(c=>!c.unconfirmed&&!reserved.has(c.utxo.txid+':'+c.utxo.vout));
 }
 async cancel(id:string){const op=await this.operation(id);if(op.raw||op.txid)throw Error('A signed/submitted transaction cannot be recalled; reconcile it instead');op.stage='cancelled';op.error='Unsigned plan discarded. Prepared funding, if any, remains in the wallet.';return this.save(op);}
 async create(parameters:GenesisParameters,keys:WalletKey[]) {
  validateVaultParameters(parameters);const {owner,change}=this.identity(keys);
  if(!this.inventory||json(keys)!==json(this.keys))throw Error('Check this connected wallet’s chipnet balances first');
  if(!this.inventory.coins.some(c=>c.utxo.token?.category===parameters.stakingCategory&&!c.utxo.token.nft&&c.utxo.token.amount>0n))throw Error('The staking category must be proven by a confirmed fungible UTXO in the scanned wallet');
  const coins=chooseBch(await this.availableCoins(),vaultFunding(parameters).total+1000n),clock=await verifyCoinsAcrossPeers(this.provider,coins.map(c=>c.utxo));
  const op:WalletOperation={version:1,network:'chipnet',id:crypto.randomUUID(),kind:'create',step:'funding',stage:'review',parameters,owner,change,coins,clock,updatedAt:this.now()};op.plan=await this.canonicalPlan(op,keys,clock);return this.save(op);
 }
 async offer(config:VaultConfig,terms:OfferTerms,keys:WalletKey[]) {
  validateVaultParameters(config);const amount=validateOfferTerms(config,terms),{owner,change}=this.identity(keys);await this.eligibleVault(config);
  if(!this.inventory||json(keys)!==json(this.keys))throw Error('Check this connected wallet’s chipnet balances first');
  const available=await this.availableCoins(),exact=available.find(c=>c.utxo.satoshis===10000n&&c.utxo.token?.category===config.stakingCategory&&!c.utxo.token.nft&&c.utxo.token.amount===amount);
  const coins=exact?[exact]:chooseTokens(available,config.stakingCategory,amount),clock=await verifyCoinsAcrossPeers(this.provider,coins.map(c=>c.utxo));
  const op:WalletOperation={version:1,network:'chipnet',id:crypto.randomUUID(),kind:'offer',step:exact?'register':'preparation',stage:'review',parameters:config,config,terms,owner,change,coins,clock,updatedAt:this.now()};
  // Validate registration eligibility even if preparation is needed; no wallet coins are spent for a closed vault.
  const vault=this.index.vaults.find(v=>v.config.genesis===config.genesis)!;const state=hexToBin(vault.witness);if(state[4]||state[5]>=16||new DataView(state.buffer,state.byteOffset).getUint32(0,true)>=config.periods)throw Error('Registration closed: activated, completed, or lifetime capacity reached');
  op.plan=await this.canonicalPlan(op,keys,clock);return this.save(op);
 }
 async submit(id:string,raw:string,keys:WalletKey[]) {
  const op=await this.operation(id);
  if(op.stage==='cancelled'||op.step==='complete'||op.stage==='pending'||op.stage==='confirmed')throw Error('Operation is discarded, pending, or already confirmed; reconcile before spending');
  try {
   const clock=await verifyCoinsAcrossPeers(this.provider,op.coins.map(c=>c.utxo));
   const canonical=await this.canonicalPlan(op,keys,op.clock!);
   if(!op.plan||walletPlanIdentity(canonical)!==walletPlanIdentity(op.plan))throw Error('Stored plan differs from the canonical transaction; rebuild and approve again');
   const result=validateWalletSigned(canonical,raw,clock);op.plan=canonical;
   if(op.step==='funding'&&result.txid===op.parameters.stakingCategory)throw Error('State and staking categories would collide; rebuild before funding');
   op.raw=raw;op.txid=result.txid;op.observation=undefined;op.stage='ready';op.error=undefined;await this.save(op); // mandatory write ahead of wire
   return await this.relay(op,clock);
  } catch(error) {op.stage=String(error).includes('conflict')||String(error).includes('spent')?'conflict':'error';op.observation=op.stage==='conflict'?'conflicted':'unavailable';op.error=String(error);await this.save(op);throw error;}
 }
 private async relay(op:WalletOperation,clock:KeeperClock) {
  const p=this.provider,decoded=decodeRawTransaction(op.raw!),coins=op.step==='genesis'?[utxo(decodeRawTransaction((await confirmedWalletTransaction(p,op.pregenesis!)).hex),0)]:op.plan!.request.sourceOutputs.map((source,n)=>({txid:decoded.vin[n].txid,vout:decoded.vin[n].vout,satoshis:source.valueSatoshis,lockingBytecode:binToHex(source.lockingBytecode),...(source.token?{token:{category:binToHex(source.token.category),amount:source.token.amount,...(source.token.nft?{nft:{capability:source.token.nft.capability,commitment:binToHex(source.token.nft.commitment)}}:{})}}:{})}));
  if(op.kind==='offer')await this.eligibleVault(op.config!);
  const quorum=await verifyCoinsAcrossPeers(p,coins);
  if(op.kind==='offer')this.offerCutoff(op.config!,quorum);
  try {await p.session(async()=>{const current=await verifyCoins(p,coins,walletPeers(p)[0]);if(current.hash!==quorum.hash||current.mtp!==quorum.mtp)throw Error('Tip changed after provider agreement; reconcile before retry');if(op.step==='genesis')validateKeeperTransaction(op.raw!,coins.map(sourceOutput),current,10000n);else validateWalletSigned(op.plan!,op.raw!,current);if(op.kind==='offer')this.offerCutoff(op.config!,current);this.onProgress?.('Broadcasting approved chipnet transaction; confirmation is not implied');await p.sendRawTransaction(op.raw!);},walletPeers(p)[0]);op.stage='pending';op.observation='submitted';op.error=undefined;}
  catch(error){op.stage='error';op.observation='unavailable';op.error='Submission rejected or acknowledgement uncertain. Reconcile before retrying. '+String(error);}
  return this.save(op);
 }
 async get(id:string) {
  const op=await this.operation(id);if(op.stage==='cancelled'||!op.txid)return op;
  try {const tx=await confirmedWalletTransaction(this.provider,op.txid);op.stage=tx.confirmations>0?'confirmed':'pending';op.observation=tx.confirmations>0?'confirmed':'unconfirmed';op.error=undefined;
   if(tx.confirmations>0&&op.kind==='create'&&['genesis','complete'].includes(op.step)){const config={...op.parameters,genesis:op.genesis??op.txid};await this.importVault(config);op.config=config;op.step='complete';}
   if(tx.confirmations>0&&op.kind==='offer'&&['register','complete'].includes(op.step)){const vault=await this.freshVault(op.config!);if(!vault.history.some(h=>h.txid===op.txid&&h.action===0))throw Error('Confirmed transaction is absent from canonical registration lineage');op.registration=op.txid;op.step='complete';}
  }
  catch(error){
   const previouslyObserved=['unconfirmed','confirmed','dropped-or-replaced'].includes(op.observation??'');
   const reports=await Promise.allSettled(walletPeers(this.provider).map(peer=>this.provider.session(()=>this.provider.transactionStatus(op.txid!),peer)));
   const absent=reports.every(r=>r.status==='rejected'&&missing(r.reason));
   op.observation=op.stage==='conflict'?'conflicted':absent?(previouslyObserved?'dropped-or-replaced':'submitted'):'unavailable';
   op.stage=op.stage==='conflict'?'conflict':'error';op.error=(missing(error)?'Transaction is not currently proven on both providers. Signed bytes are retained. ':'Provider unavailable or disagrees; no transaction sent. ')+String(error);}
  return this.save(op);
 }
 async advance(id:string,keys:WalletKey[]) {
  let op=await this.get(id);
  if(op.kind==='create'&&['genesis','complete'].includes(op.step)&&op.stage==='error')return this.completeFactory(op);
  if(op.stage==='pending')return op;
  if(op.stage==='review'&&!op.raw){op.clock=await verifyCoinsAcrossPeers(this.provider,op.coins.map(c=>c.utxo));op.plan=await this.canonicalPlan(op,keys,op.clock);return this.save(op);}
  if(op.stage==='error'&&op.raw) {
   // Retry the identical already-approved transaction only if both peers prove its exact sources remain unspent.
   if(op.step==='genesis')return this.completeFactory(op);
   return this.submit(op.id,op.raw,keys);
  }
  if(op.stage==='conflict') {op.raw=undefined;op.txid=undefined;op.plan=undefined;op.clock=await verifyCoinsAcrossPeers(this.provider,op.coins.map(c=>c.utxo));op.plan=await this.canonicalPlan(op,keys,op.clock);op.stage='review';op.error=undefined;return this.save(op);}
  if(op.stage!=='confirmed')return op;
  if(op.kind==='create') {
   if(op.step==='funding'){op.pregenesis=op.txid;return this.completeFactory(op);}
   const config={...op.parameters,genesis:op.genesis??op.txid!};await this.importVault(config);op.config=config;op.step='complete';return this.save(op);
  }
  if(op.step==='preparation') {
   op.preparation=op.txid;const tx=await confirmedWalletTransaction(this.provider,op.txid!),clock=await verifyCoinsAcrossPeers(this.provider,[utxo(tx,0)]);
   op.coins=[{...op.owner!,utxo:utxo(tx,0)}];op.step='register';op.raw=undefined;op.txid=undefined;op.observation=undefined;op.plan=undefined;op.clock=clock;
   try{op.plan=await this.canonicalPlan(op,keys,clock);op.stage='review';op.error=undefined;}catch(error){op.stage='conflict';op.error='Preparation remains wallet-owned and reusable. '+String(error);}
   return this.save(op);
  }
  await this.freshVault(op.config!);op.registration=op.txid;op.step='complete';return this.save(op);
 }
 private async completeFactory(op:WalletOperation) {
  const p=this.provider,parent=await confirmedWalletTransaction(p,op.pregenesis??op.txid!);if(parent.confirmations<=0){op.stage='pending';return this.save(op);}
  op.pregenesis=parent.txid;
  // Another user can validly finish the permissionless factory. Adopt that canonical genesis instead of racing blindly.
  const children=await p.session(async()=>{const history=await p.history(parent.vout[0].scriptPubKey.hex),result:string[]=[];for(const h of history.filter(h=>h.height>0)){const tx=await p.transaction(h.tx_hash,h.height);if(tx.vin.length===1&&tx.vin[0].txid===parent.txid&&tx.vin[0].vout===0)result.push(tx.txid);}return result;},walletPeers(p)[0]);
  if(children.length>1)throw Error('Conflicting confirmed factory spends');
  if(children.length){const config={...op.parameters,genesis:children[0]};await this.importVault(config);op.genesis=children[0];op.txid=children[0];op.raw=(await confirmedWalletTransaction(p,children[0])).hex;op.config=config;op.step='complete';op.stage='confirmed';return this.save(op);}
  const clock=await verifyCoinsAcrossPeers(p,[utxo(parent,0)]),raw=await buildGenesis(op.parameters,parent,p,clock);
  op.step='genesis';op.observation=undefined;op.raw=raw;op.txid=decodeRawTransaction(raw).txid;op.genesis=op.txid;op.clock=clock;op.stage='ready';await this.save(op);return this.relay(op,clock);
 }
 async recover(parameters:GenesisParameters,pregenesis:string) {
  validateVaultParameters(parameters);const parent=await confirmedWalletTransaction(this.provider,pregenesis),clock=await this.provider.session(async()=>{const tip=await this.provider.tip();return {height:tip.height,mtp:await this.provider.medianTime(tip.height,tip.hash)};},walletPeers(this.provider)[0]);
  await buildGenesis(parameters,parent,this.provider,clock); // prove the exact factory and feasible reserve before saving recovery
  const op:WalletOperation={version:1,network:'chipnet',id:crypto.randomUUID(),kind:'create',step:'funding',stage:parent.confirmations>0?'confirmed':'pending',parameters,pregenesis,txid:pregenesis,coins:[],updatedAt:this.now()};return this.save(op);
 }
 async importVault(config:VaultConfig, allowPending=false) {
  validateVaultParameters(config);if(!/^[a-f0-9]{64}$/.test(config.genesis))throw Error('Invalid genesis transaction ID');
  const confirmed=await confirmedWalletTransaction(this.provider,config.genesis);
  if(confirmed.confirmations<=0){
   if(!allowPending)throw Error('Genesis must be confirmed for operation completion');
   const display=new ElectrumIndexer([config],this.provider,undefined,0);await display.sync();
   const vault=display.displayVaults?.find(v=>v.config.genesis===config.genesis);
   if(display.displayError||!vault)throw Error(display.displayError||'Unconfirmed genesis could not be validated');
   return {config,category:vault.category};
  }
  let category='';for(const peer of walletPeers(this.provider))await this.provider.session(async()=>{const proof=await verifyRegistryGenesis(config.genesis,config,id=>this.provider.transactionStatus(id),this.provider);if(proof.confirmationBlock!==confirmed.blockhash)throw Error('Genesis confirmation disagreement');if(category&&category!==proof.category)throw Error('Genesis provider disagreement');category=proof.category;},peer);
  return {config,category};
 }
}
