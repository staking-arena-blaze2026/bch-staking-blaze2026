import {utxo} from '../arena-core.js';
import type {ElectrumCore,HistoryEntry} from '../electrum-core.js';
import {discoveryScript} from '../v3/discovery.js';
import {v3Network,type V3Network} from '../v3/network.js';
import {QueueIndexer,type Config} from './chain.js';
import {announcementIn,type Announcement} from './discovery.js';
import {authenticateGenesis} from './indexer.js';

export interface QueueIndexState {
 network:V3Network;
 seen:string[];
 pending:Record<string,Announcement>;
 vaults:Record<string,Config>;
 counts?:Record<string,OfferCount>;
}
export interface OfferCount {network:V3Network;vaultId:string;waiting:number;updatedAt:string}

export function emptyQueueIndex(network:V3Network):QueueIndexState {
 return {network,seen:[],pending:{},vaults:{}};
}

/** Refresh the oldest counts first. Retain the last observation during outages. */
export async function refreshQueueCounts(state:QueueIndexState,providers:readonly ElectrumCore[],budgetMs:number){
 const counts=state.counts??={},deadline=Date.now()+budgetMs;
 const vaults=Object.values(state.vaults).sort((a,b)=>(counts[a.anchor.genesis]?.updatedAt??'').localeCompare(counts[b.anchor.genesis]?.updatedAt??''));
 let next=0,updated=0;
 await Promise.all(providers.map(async p=>{
  if(v3Network(p)!==state.network)throw Error('Queue count network mismatch');
  while(next<vaults.length&&Date.now()<deadline){
   const c=vaults[next++]!,vaultId=c.anchor.genesis;
   try {
    const queue=await new QueueIndexer(p,c).reportedDisplay();
    counts[vaultId]={network:state.network,vaultId,waiting:queue.ordered.length,updatedAt:new Date().toISOString()};
    updated++;
   }catch{/* A failed or inconsistent report must never replace a count with zero. */}
  }
 }));
 return updated;
}

/** A confirmed child commits to its source txids. Read and hash-check those
 * immutable bytes to authenticate the covenant and its full initial reserve. */
export async function confirmedAnnouncement(p:ElectrumCore,row:HistoryEntry,a:Announcement):Promise<Config> {
 const tx=await p.transactionStatus(row.tx_hash,row);
 if(tx.confirmations<1)throw Error('Awaiting on-chain confirmation');
 if(!tx.vout.some((out:{scriptPubKey:{hex:string}})=>out.scriptPubKey.hex===discoveryScript(v3Network(p))))throw Error('Missing public discovery marker');
 const sources=await Promise.all(tx.vin.map(async(input:{txid:string;vout:number})=>utxo(await p.transaction(input.txid),input.vout)));
 const config:Config={parameters:a.parameters,identity:{vault:tx.vin[0]?.txid,queue:a.queue},anchor:{genesis:row.tx_hash,creator:a.creator}};
 authenticateGenesis({p:a.parameters,identity:config.identity,provider:p},config.anchor,tx.hex,sources);
 return config;
}

/** Read-only discovery. Check each peer even when another peer has usable
 * history. Only immutable, decoded transactions can be ruled out permanently. */
export async function scanQueueIndex(state:QueueIndexState,provider:ElectrumCore,budgetMs:number,known:ReadonlySet<string>=new Set()) {
 if(v3Network(provider)!==state.network)throw Error('Queue index network mismatch');
 const deadline=Date.now()+budgetMs;
 const script=discoveryScript(state.network),seen=new Set(state.seen),reasons=new Map<string,string>();
 const errors:string[]=[];
 let online=0;
 await Promise.all(provider.endpoints.map(async endpoint=>{
  const peer=provider.independentReader(endpoint)??provider;
  try {
   await peer.session(async()=>{
    const history=await peer.history(script);
    online++;
    const rows=new Map(history.map(row=>[row.tx_hash,row]));
    const attempted=new Set<string>();
    const verify=async(seed:string,a:Announcement,row?:HistoryEntry)=>{
     if(state.vaults[seed]||known.has(seed))return;
     if(!row||row.height<=0){
      if(!reasons.has(seed))reasons.set(seed,row?'Awaiting on-chain confirmation':'Announcement not visible on an index provider');
      return;
     }
     // Rotate attempted items so one slow or invalid candidate cannot
     // permanently occupy the head of a bounded retry batch.
     attempted.add(seed);
     delete state.pending[seed];
     state.pending[seed]=a;
     try {
      state.vaults[seed]=await confirmedAnnouncement(peer,row,a);
      delete state.pending[seed];
      reasons.delete(seed);
     }catch(error){
      if(!state.vaults[seed])reasons.set(seed,String(error));
     }
    };
    const pending=Object.entries(state.pending);
    for(const [seed,a] of pending.filter(([seed])=>(rows.get(seed)?.height??0)>0).slice(0,20)){
     if(Date.now()>=deadline)break;
     await verify(seed,a,rows.get(seed));
    }
    const candidates=history.filter(({tx_hash,height})=>!known.has(tx_hash)&&!state.vaults[tx_hash]&&(!seen.has(tx_hash)||height>0&&state.pending[tx_hash]&&!attempted.has(tx_hash)));
    for(const row of candidates.slice(0,100)){
     if(Date.now()>=deadline)break;
     const pending=state.pending[row.tx_hash];
     if(pending){
      await verify(row.tx_hash,pending,row);
      continue;
     }
     if(seen.has(row.tx_hash))continue;
     try {
      const tx=await peer.transaction(row.tx_hash),a=announcementIn(tx);
      if(a)state.pending[row.tx_hash]=a;
      seen.add(row.tx_hash);
      if(a)await verify(row.tx_hash,a,row);
     }catch(error){
      if(!state.vaults[row.tx_hash])reasons.set(row.tx_hash,String(error));
     }
    }
    for(const [seed] of pending)if(state.pending[seed]&&!reasons.has(seed)){
     const row=rows.get(seed);
     reasons.set(seed,!row?'Announcement not visible on an index provider':row.height<=0?'Awaiting on-chain confirmation':'Verification queued for the next scan');
    }
   },endpoint);
  }catch(error){errors.push(String(error));}
 }));
 state.seen=[...seen];
 for(const seed of Object.keys(state.vaults))delete state.pending[seed];
 return {online,errors,pending:Object.fromEntries([...reasons].filter(([seed])=>!state.vaults[seed]).slice(0,100))};
}
