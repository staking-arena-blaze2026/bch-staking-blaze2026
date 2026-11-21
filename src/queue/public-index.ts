import {utxo} from '../arena-core.js';
import {boundedMap} from '../bounded-map.js';
import type {decodeRawTransaction,ElectrumCore,HistoryEntry} from '../electrum-core.js';
import {discoveryScript} from '../v3/discovery.js';
import {v3Network,type V3Network} from '../v3/network.js';
import type {Config} from './chain.js';
import {readQueueCatalog,type CatalogReward,type OfferCount} from './catalog.js';
import {announcementIn,type Announcement} from './discovery.js';
import {authenticateGenesis} from './indexer.js';
import {ZERO} from './model.js';

export interface QueueIndexState {
 network:V3Network;
 seen:string[];
 pending:Record<string,Announcement>;
 vaults:Record<string,Config>;
 counts?:Record<string,OfferCount>;
 rewards?:Record<string,CatalogReward>;
}

export function emptyQueueIndex(network:V3Network):QueueIndexState {
 return {network,seen:[],pending:{},vaults:{}};
}

/** Refresh the oldest observations first and keep the last successful data. */
export async function refreshQueueCatalog(state:QueueIndexState,p:ElectrumCore,budgetMs:number){
 if(v3Network(p)!==state.network)throw Error('Queue catalog network mismatch');
 const counts=state.counts??={},rewards=state.rewards??={};
 const age=(c:Config)=>[counts[c.anchor.genesis]?.updatedAt??'',rewards[c.anchor.genesis]?.updatedAt??''].sort()[0]!;
 const vaults=Object.values(state.vaults).sort((a,b)=>age(a).localeCompare(age(b)));
 let countsUpdated=0,rewardsUpdated=0;
 try {
  await readQueueCatalog(p,vaults.map(config=>({config,reward:true,count:true})),value=>{
   if(value.count){counts[value.vaultId]=value.count;countsUpdated++;}
   if(value.reward){
    rewards[value.vaultId]=value.reward;rewardsUpdated++;
   }
  },Date.now()+budgetMs);
 }catch{/* An unavailable provider leaves the checkpoint intact. */}
 return {countsUpdated,rewardsUpdated};
}

type Decoded=ReturnType<typeof decodeRawTransaction>;
export interface QueueCandidate {
 config:Config;
 height:number;
 status:'provisional'|'observed-confirmed';
}

async function authenticateAnnouncement(p:ElectrumCore,tx:Decoded,a:Announcement) {
 const marker=a.parameters.rewardCategory===ZERO?2:3;
 if(tx.vout[marker]?.scriptPubKey.hex!==discoveryScript(v3Network(p)))throw Error('Missing public discovery marker');
 if(tx.vin.length<2||tx.vin.length>16)throw Error('Noncanonical genesis inputs');
 const parents:Decoded[]=await Promise.all(tx.vin.map(input=>p.transaction(input.txid)));
 const sources=tx.vin.map((input,i)=>utxo(parents[i],input.vout));
 const config:Config={parameters:a.parameters,identity:{vault:tx.vin[0]!.txid,queue:a.queue},anchor:{genesis:tx.txid,creator:a.creator}};
 authenticateGenesis({p:a.parameters,identity:config.identity,provider:p},config.anchor,tx.hex,sources);
 return {config,parents};
}

function announcementSpends(transactions:Decoded[]) {
 const spends=new Map<string,string>();
 for(const child of transactions)for(const input of child.vin){
  if(input.vout===0xffffffff&&input.txid===ZERO)continue;
  const outpoint=input.txid+':'+input.vout,previous=spends.get(outpoint);
  if(previous&&previous!==child.txid)throw Error('Conflicting genesis dependencies');
  spends.set(outpoint,child.txid);
 }
 return spends;
}

export async function confirmedAnnouncement(p:ElectrumCore,row:HistoryEntry,a:Announcement):Promise<Config> {
 const tx=await p.transactionStatus(row.tx_hash,row);
 if(tx.confirmations<1)throw Error('Awaiting on-chain confirmation');
 return (await authenticateAnnouncement(p,tx,a)).config;
}

/** Ephemeral public hints. The peer's live marker mempool attests
 * acceptance of the genesis and its dependencies. Authenticate the genesis
 * against its hash-checked inputs before displaying anything. Refresh presence
 * even when the transaction bytes have already been authenticated. */
export async function scanQueueMempool(provider:ElectrumCore,tracked:Map<string,QueueCandidate>,
 known:ReadonlySet<string>=new Set(),priority:ReadonlySet<string>=new Set()):Promise<QueueCandidate[]> {
 const script=discoveryScript(v3Network(provider));
 const results=await Promise.all(provider.endpoints.map(async endpoint=>{
  const peer=provider.independentReader(endpoint)??provider;
  try{
   return await peer.session(async()=>{
    const rows=(await peer.mempool(script)).filter(row=>!known.has(row.tx_hash));
    const present=new Set(rows.map(row=>row.tx_hash));
    const missing=new Set([...tracked.keys(),...priority].filter(id=>!known.has(id)&&!present.has(id)));
    if(missing.size){
     const confirmed=await peer.history(script).catch(()=>[]);
     rows.push(...confirmed.filter(row=>row.height>0&&missing.has(row.tx_hash)));
    }
    rows.sort((a,b)=>Number(priority.has(b.tx_hash))-Number(priority.has(a.tx_hash))||
     Number(tracked.has(b.tx_hash))-Number(tracked.has(a.tx_hash)));
    return await boundedMap(rows.slice(0,24),6,async row=>{
     try{
      const raw:Decoded=await peer.transaction(row.tx_hash);
      const a=announcementIn(raw);
      if(!a)return;
      const {config,parents}=await authenticateAnnouncement(peer,raw,a);
      if(row.height>0&&(await peer.transactionStatus(row.tx_hash,row)).confirmations<1)return;
      const candidate:QueueCandidate={config,height:row.height,status:row.height>0?'observed-confirmed':'provisional'};
      return {spends:announcementSpends([raw,...parents]),candidate};
     }catch{/* Incomplete or invalid evidence cannot make a candidate public. */}
    });
   },endpoint);
  }catch{return [];}
 }));
 const observed=results.flat().filter(row=>row!==undefined);
 const spenders=new Map<string,Set<string>>();
 for(const row of observed)for(const [point,txid] of row.spends){
  const ids=spenders.get(point)??new Set<string>();
  ids.add(txid);
  spenders.set(point,ids);
 }
 tracked.clear();
 for(const {candidate,spends} of observed){
  if([...spends.keys()].some(point=>spenders.get(point)!.size>1))continue;
  const id=candidate.config.anchor.genesis;
  if(!tracked.has(id)||candidate.height>tracked.get(id)!.height)tracked.set(id,candidate);
 }
 return [...tracked.values()];
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
