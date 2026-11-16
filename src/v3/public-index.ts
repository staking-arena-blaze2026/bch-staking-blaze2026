import type {Config} from './indexer.js';
import type {ElectrumCore} from '../electrum-core.js';
import {discoveryScripts,parseAnnouncement} from './discovery.js';
import {family} from './protocol.js';
import {v3Network,type V3Network} from './network.js';
import {validateParameters} from './model.js';
export const INDEX_SCHEMA=1;
export interface Candidate {config:Config;announcement:string;height:number;status:'observed-confirmed'|'provisional'|'not-observed';}
export interface IndexState {schema:1;network:V3Network;processed:Record<string,'irrelevant'|'parent'|'vault'>;candidates:Record<string,Candidate>;updatedAt?:string;}
export function emptyIndex(network:V3Network):IndexState{return {schema:1,network,processed:{},candidates:{}};}
/** Whitelist fields. Index data is always a hint, never a Snapshot or authorization. */
export function candidateConfig(value:any):Config{
 if(!value||!/^([a-f0-9]{64})$/.test(value.genesis)||!/^\d{1,7}$/.test(String(value.cap)))throw Error('Invalid index configuration');
 const asset=(a:any)=>{if(a?.kind==='bch')return {kind:'bch' as const};if(a?.kind==='token'&&/^[a-f0-9]{64}$/.test(a.category))return {kind:'token' as const,category:a.category};throw Error('Invalid index asset');};
 return {...validateParameters({version:value.version,registryVersion:value.registryVersion,discovery:value.discovery,stakingAsset:asset(value.stakingAsset),rewardAsset:asset(value.rewardAsset),epoch:value.epoch,periodSeconds:value.periodSeconds,periods:value.periods,cap:BigInt(value.cap)}),genesis:value.genesis};
}
export function parseCandidates(rows:unknown):Candidate[]{
 if(!Array.isArray(rows)||rows.length>20)throw Error('Oversized index page');
 const found=new Map<string,Candidate>(),conflicts=new Set<string>();
 for(const row of rows)try{const config=candidateConfig(row.config);if(!/^[a-f0-9]{64}$/.test(row.announcement)||!Number.isSafeInteger(row.height)||row.height< -1||!['observed-confirmed','provisional','not-observed'].includes(row.status))continue;const old=found.get(config.genesis);if(old&&stringify(old.config)!==stringify(config))conflicts.add(config.genesis);else found.set(config.genesis,{config,announcement:row.announcement,height:row.height,status:row.status});}catch{/* A malformed row cannot poison other candidates. */}
 return [...found.values()].filter(c=>!conflicts.has(c.config.genesis));
}
export const stringify=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
/** Persistent negative results make legacy catch-up incremental. Failed network reads
 * are retried; parent announcements are revisited until a child is observed.
 * All raw transactions are txid checked by ElectrumCore. No index value is financial. */
export async function updatePublicIndex(state:IndexState,providers:ElectrumCore[],budget=1500){
 if(!providers.length||providers.some(p=>v3Network(p)!==state.network)||budget<1||budget>5000)throw Error('Invalid index update');
 const observed=new Map<string,{height:number;providers:ElectrumCore[]}>();let online=0;const errors:string[]=[];
 await Promise.all(providers.map(async p=>{try{const histories=await p.session(()=>Promise.all(discoveryScripts(state.network).map(s=>p.history(s))));online++;for(const h of histories.flat()){const old=observed.get(h.tx_hash);if(old){old.providers.push(p);old.height=Math.min(old.height,h.height);}else observed.set(h.tx_hash,{height:h.height,providers:[p]});}}catch(e){errors.push(String(e));}}));
 if(!online)return {online,errors,observed:0,remaining:undefined,read:0};
 const all=[...observed].sort((a,b)=>b[1].height-a[1].height||a[0].localeCompare(b[0]));
 const unknown=all.filter(([id])=>!state.processed[id]),parents=Object.keys(state.processed).filter(id=>state.processed[id]==='parent'&&observed.has(id)).map(id=>[id,observed.get(id)!] as [string,{height:number;providers:ElectrumCore[]}]);
 const retry=parents.slice(0,Math.max(1,Math.floor(budget/5))),work=[...retry,...unknown.slice(0,budget-retry.length)];
 let at=0,read=0;
 await Promise.all(providers.map(async p=>{await p.session(async()=>{await Promise.all(Array.from({length:4},async()=>{for(;;){const item=work[at++];if(!item)return;const [id,entry]=item;
 try{const tx=await p.transaction(id);read++;const marker=tx.vout.findIndex((o:any)=>discoveryScripts(state.network).includes(o.scriptPubKey.hex)&&o.value===0.00001&&!o.tokenData),script=tx.vout[marker+1]?.scriptPubKey.hex;
 if(marker<0||typeof script!=='string'||!/^6a4c5a[0-9a-f]{180}$/.test(script)){state.processed[id]='irrelevant';continue;}
 let parsed;try{parsed=parseAnnouncement(script.slice(6));}catch{state.processed[id]='irrelevant';continue;}
 const configs:Array<{config:Config;height:number}>=[];
 if(parsed.mode==='direct')configs.push({config:{...parsed.parameters,genesis:id},height:entry.height});
 else{const history=await p.history(family(parsed.parameters,id,p).registry.lockingBytecode);if(history.length>512)throw Error('Parent history budget exceeded');for(const h of history){const child=await p.transaction(h.tx_hash);if(child.vin[0]?.txid===id&&child.vin[0]?.vout===0)configs.push({config:{...parsed.parameters,genesis:h.tx_hash},height:h.height});}}
 state.processed[id]=parsed.mode==='parent'?'parent':'vault';
 if(parsed.mode==='parent')for(const c of Object.values(state.candidates))if(c.announcement===id&&!configs.some(v=>v.config.genesis===c.config.genesis))c.status='not-observed';
 for(const {config,height} of configs)state.candidates[config.genesis]={config,announcement:id,height,status:height>0?'observed-confirmed':'provisional'};
 }catch(e){errors.push(id+': '+String(e));}
 }}));});}).map(task=>task.catch(e=>errors.push(String(e)))));
 for(const c of Object.values(state.candidates)){const seen=observed.get(c.announcement);if(seen&&c.announcement===c.config.genesis){c.height=seen.height;c.status=seen.height>0?'observed-confirmed':'provisional';}else if(!seen&&online===providers.length)c.status='not-observed';}
 // Rotate retry parents so a permanently missing child cannot starve later parents.
 for(const [id]of retry){const value=state.processed[id];delete state.processed[id];state.processed[id]=value;}
 state.updatedAt=new Date().toISOString();
 return {online,errors:errors.slice(0,30),observed:observed.size,remaining:unknown.filter(([id])=>!state.processed[id]).length,read};
}
