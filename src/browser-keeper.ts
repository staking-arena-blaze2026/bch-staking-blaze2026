import { Network } from 'cashscript';
import type { ElectrumCore, HistoryEntry } from './electrum-core.js';
import { decodeRawTransaction } from './electrum-core.js';
import { ElectrumIndexer, type VaultState } from './indexer-core.js';
import { buildKeeperTransition, FeeFundingUnavailable, keeperDecision, sourceOutput, validateKeeperTransaction } from './keeper-core.js';
import { utxo, json, transitionWitness } from './arena-core.js';

export type SettlementPhase='waiting'|'activation-required'|'settlement-required'|'broadcasting'|'pending'|'confirmed'|'retrying'|'blocked'|'complete';
export interface SettlementStatus { phase:SettlementPhase; message:string; updatedAt:string; txid?:string; period?:number; action?:number; slot?:number; nextRetryAt?:number; fee?:string }
export interface SettlementIntent {
  version:1; network:'chipnet'; category:string; parent:string; txid:string; raw:string; action:number; slot:number; period:number;
  phase:'prepared'|'submitted'|'uncertain'|'confirmed'|'superseded'; endpoint?:string; attempts:number; nextRetryAt:number; updatedAt:number; error?:string;
}
export interface IntentStore { load(category:string):Promise<SettlementIntent|undefined>; save(intent:SettlementIntent):Promise<void> }
export type SettlementLock=(category:string,work:()=>Promise<void>)=>Promise<boolean>;
const relayFeeFailure=(message:string)=>/min(?:imum)? relay fee|mempool min fee|insufficient fee|fee.*too low/i.test(message);
const historyKey=(history:HistoryEntry[])=>json([...history].sort((a,b)=>a.tx_hash.localeCompare(b.tx_hash)||a.height-b.height));
const sameUtxo=(a:ReturnType<typeof utxo>,b:ReturnType<typeof utxo>)=>a.txid===b.txid&&a.vout===b.vout&&a.satoshis===b.satoshis&&a.lockingBytecode===b.lockingBytecode&&json(a.token??null)===json(b.token??null);

/** Permissionless chipnet keeper. Fresh replay, durable intent, two endpoint observations, then one pinned send.
 * No keys, wallet connection, optimistic state, mempool ancestry, or fee replacement. */
export class BrowserKeeper {
  statuses:Record<string,SettlementStatus>={};
  onChange?:()=>void;
  canBroadcast?: (category:string)=>boolean;
  private busy=false;
  constructor(readonly index:ElectrumIndexer,readonly intents:IntentStore,readonly lock:SettlementLock,readonly now=()=>Date.now()) {}
  private set(category:string,status:Omit<SettlementStatus,'updatedAt'>) {this.statuses[category]={...status,updatedAt:new Date(this.now()).toISOString()};this.onChange?.();}
  async tick(automatic=true,manual?:string) {
    if(this.busy)return;
    this.busy=true;
    try {
      await this.index.sync();
      for(const vault of this.index.vaults) {
        try {
          const acquired=await this.lock(vault.category,()=>this.step(vault,automatic||manual===vault.category));
          if(!acquired)this.set(vault.category,{phase:'waiting',message:'Another tab is processing this vault'});
        } catch(error) {this.set(vault.category,{phase:'retrying',message:String(error)});}
      }
    } catch(error) {
      for(const config of this.index.configs) {
        const vault=this.index.vaults.find(v=>v.config.genesis===config.genesis);
        if(vault)this.set(vault.category,{phase:'retrying',message:'Synchronization unavailable; no transaction sent. '+String(error)});
      }
      throw error;
    } finally {this.busy=false;}
  }
  private async step(vault:VaultState,allowed:boolean) {
    const p=this.index.electrum!,tip=this.index.tip;
    if(p.network!==Network.CHIPNET || !this.index.health.connected || this.index.health.stale || !tip || this.now()-Date.parse(this.index.health.updatedAt)>60000)throw Error('A fresh verified chipnet snapshot is required');
    const clock={height:tip.height,mtp:tip.mtp,nextBlockTicks:tip.nextBlockTicks},decision=keeperDecision(vault,clock),parent=`${vault.transaction.txid}:0`;
    let intent=await this.intents.load(vault.category);
    if(intent && (intent.version!==1 || intent.network!=='chipnet' || intent.category!==vault.category || !/^[0-9a-f]{64}$/.test(intent.txid) || !Number.isSafeInteger(intent.nextRetryAt) || intent.nextRetryAt<0 || !Number.isSafeInteger(intent.attempts) || intent.attempts<1 || !['prepared','submitted','uncertain','confirmed','superseded'].includes(intent.phase) || ![2,3,5].includes(intent.action) || !Number.isInteger(intent.slot) || intent.slot<0 || intent.slot>15 || !Number.isInteger(intent.period) || intent.period<0 || intent.period>=vault.config.periods || !/^[0-9a-f]{64}:0$/.test(intent.parent) || typeof intent.raw!=='string'))throw Error('Invalid settlement journal; no transaction sent');
    if(intent && vault.history.some(h=>h.txid===intent!.txid)) {
      if(intent.phase!=='confirmed') {
        intent={...intent,phase:'confirmed',updatedAt:this.now(),error:undefined};await this.intents.save(intent);
        this.set(vault.category,{phase:'confirmed',message:'Confirmed on the canonical registry lineage',txid:intent.txid,period:intent.period,action:intent.action,slot:intent.slot});return;
      }
      if(decision.phase==='complete') {this.set(vault.category,{phase:'confirmed',message:'Confirmed; all periods processed',txid:intent.txid,period:intent.period,action:intent.action});return;}
    } else if(intent?.phase==='confirmed') {
      intent={...intent,phase:'uncertain',nextRetryAt:this.now()+30000,error:'A reorganization removed the previous confirmation',updatedAt:this.now()};
      await this.intents.save(intent);this.set(vault.category,{phase:'retrying',message:intent.error!,txid:intent.txid,nextRetryAt:intent.nextRetryAt});return;
    }
    if(intent && intent.parent!==parent && intent.phase!=='superseded' && intent.phase!=='confirmed') {
      intent={...intent,phase:'superseded',updatedAt:this.now()};await this.intents.save(intent);
      this.set(vault.category,{phase:'retrying',message:'A competing confirmed transaction advanced the vault; state reconciled',txid:intent.txid});return;
    }
    if(!('action' in decision)) {this.set(vault.category,{phase:decision.phase,message:decision.phase==='complete'?'All periods processed':'Waiting for the next period using chain median time',period:decision.period});return;}
    const details={period:decision.period,action:decision.action,slot:decision.slot};
    // Detect our own or independent keepers' mempool spends without applying them to confirmed state.
    const scripts=[vault.transaction.vout[0].scriptPubKey.hex,vault.transaction.vout[1].scriptPubKey.hex];
    const observed=scripts.flatMap(script=>this.index.histories.get(script)??[]).filter(h=>h.height<=0);
    if(observed.length) {
      const pending=await p.session(async()=>{
        for(const id of new Set(observed.map(h=>h.tx_hash))) {
          const tx=await p.transaction(id);
          if(tx.vin.some((input:any)=>input.txid===vault.transaction.txid && [0,1].includes(input.vout)))return id;
        }
      },p.endpoint);
      if(pending) {this.set(vault.category,{phase:'pending',message:pending===intent?.txid?'Pending confirmation':'A competing spend is pending; waiting for confirmation',txid:pending,...details});return;}
    }
    let candidate:Awaited<ReturnType<typeof buildKeeperTransition>>;
    try {candidate=await buildKeeperTransition(vault,p,clock);}
    catch(error) {if(error instanceof FeeFundingUnavailable){this.set(vault.category,{phase:'blocked',message:error.message,...details});return;}throw error;}
    if(!candidate)return;
    if(intent?.parent===parent && intent.phase==='uncertain' && relayFeeFailure(intent.error??'') && this.now()<intent.nextRetryAt) {this.set(vault.category,{phase:'blocked',message:'The fixed unsponsored fee was rejected by relay policy; an external BCH fee sponsor is required. '+intent.error,txid:intent.txid,nextRetryAt:intent.nextRetryAt,...details});return;}
    if(!allowed && intent?.parent===parent && intent.phase==='uncertain') {this.set(vault.category,{phase:'retrying',message:intent.error??'Submission uncertain; reconciliation required',txid:intent.txid,nextRetryAt:intent.nextRetryAt,...details});return;}
    if(!allowed) {this.set(vault.category,{phase:decision.phase,message:decision.action===2?'Activation required':'Settlement required',fee:candidate.fee,...details});return;}
    if(new Set(p.endpoints.map(endpoint=>new URL(endpoint).hostname)).size<2)throw Error('Two configured chipnet Electrum hosts are required before settlement');
    const existing=intent?.parent===parent && intent.phase!=='confirmed' && intent.phase!=='superseded'?intent:undefined;
    if(existing && this.now()<existing.nextRetryAt) {this.set(vault.category,{phase:'retrying',message:existing.error??'Waiting before reconciling an unconfirmed submission',txid:existing.txid,nextRetryAt:existing.nextRetryAt,...details});return;}
    const raw=existing?.raw??candidate.raw,decoded=decodeRawTransaction(raw,existing?.txid),witness=transitionWitness(decoded.vin[0]?.scriptSig.hex??'');
    if(decoded.vin.length!==2 || decoded.vin.some((input,n)=>input.txid!==vault.transaction.txid || input.vout!==n) || witness.state.toString('hex')!==vault.witness || witness.action!==decision.action || witness.slot!==decision.slot || witness.record.length)throw Error('Journal transaction does not match the current permissionless transition');
    validateKeeperTransaction(raw,[sourceOutput(utxo(vault.transaction,0)),sourceOutput(utxo(vault.transaction,1))],clock,10000n);
    const endpoints=[p.endpoint,...p.endpoints.filter(e=>new URL(e).hostname!==new URL(p.endpoint).hostname)].slice(0,2);
    for(const endpoint of endpoints)await p.session(()=>this.verifyCurrent(p,vault),endpoint);
    const broadcastEndpoint=endpoints[(existing?.attempts??0)%endpoints.length]!;
    intent={version:1,network:'chipnet',category:vault.category,parent,raw,txid:decoded.txid,endpoint:broadcastEndpoint,...details,phase:'prepared',attempts:(existing?.attempts??0)+1,nextRetryAt:this.now()+Math.min(900000,30000*(2**Math.min(existing?.attempts??0,5))),updatedAt:this.now()};
    // Write-ahead intent survives closure or a missing broadcast acknowledgement.
    await this.intents.save(intent);
    this.set(vault.category,{phase:'broadcasting',message:'Broadcasting a locally validated chipnet transition',txid:intent.txid,fee:'10000',...details});
    try {
      await p.session(async()=>{await this.verifyCurrent(p,vault);
        if(this.canBroadcast && !this.canBroadcast(vault.category))throw Error('Settlement safety interlock prevents broadcast');
        const age=this.now()-Date.parse(this.index.health.updatedAt);
        if(!Number.isFinite(age)||age>60000||age< -60000||!this.index.health.connected||this.index.health.stale)throw Error('Verified chain data became stale before broadcast; resynchronization required');
        await p.sendRawTransaction(raw);},broadcastEndpoint);
      intent={...intent,phase:'submitted',updatedAt:this.now(),error:undefined};await this.intents.save(intent);
      this.set(vault.category,{phase:'pending',message:'Broadcast accepted; pending confirmation',txid:intent.txid,fee:'10000',...details});
    } catch(error) {
      intent={...intent,phase:'uncertain',error:String(error),updatedAt:this.now()};
      try {await this.intents.save(intent);} catch { /* The prepared write-ahead record remains authoritative. */ }
      this.set(vault.category,{phase:relayFeeFailure(String(error))?'blocked':'retrying',message:(relayFeeFailure(String(error))?'Fixed fee rejected; an external BCH fee sponsor is required. ':'Submission rejected or acknowledgement uncertain; reconciling before retry. ')+String(error),txid:intent.txid,nextRetryAt:intent.nextRetryAt,...details});
    }
  }
  private async verifyCurrent(p:ElectrumCore,vault:VaultState) {return verifyCanonicalVault(this.index,p,vault);}
}
export async function verifyCanonicalVault(index:ElectrumIndexer,p:ElectrumCore,vault:VaultState) {
    const expected=index.tip!,tip=await p.tip();
    if(tip.height!==expected.height || tip.hash!==expected.hash || await p.medianTime(tip.height,tip.hash)!==expected.mtp)throw Error('Electrum tip/MTP disagreement or stale indexed state');
    const tx=await p.transaction(vault.transaction.txid,vault.transaction.height);
    if(tx.height!==vault.transaction.height || tx.blockhash!==vault.transaction.blockhash || tx.confirmations<=0 || tx.height>tip.height)throw Error('Covenant input confirmation mismatch');
    for(const n of [0,1]) {
      const expectedUtxo=utxo(vault.transaction,n),script=expectedUtxo.lockingBytecode!;
      const history=await p.history(script),known=index.histories.get(script);
      if(!known || historyKey(history)!==historyKey(known))throw Error('Electrum script history disagreement; resynchronization required');
      const actual=(await p.getUtxosForLockingBytecode(script)).find(u=>u.txid===expectedUtxo.txid&&u.vout===n);
      if(!actual || !sameUtxo(expectedUtxo,actual))throw Error('Covenant output is spent, pending, or disagrees across providers');
    }
    await p.verifyHeaderChain(tx.height,tip,new Map([[tx.height,tx.blockhash]]));
    if((await p.tip()).hash!==tip.hash)throw Error('Chain changed before settlement broadcast');
}
