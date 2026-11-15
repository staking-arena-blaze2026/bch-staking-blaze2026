import type {ElectrumCore} from '../electrum-core.js';
import {walletPeers} from '../electrum-wallet.js';
import {DISCOVERY_SCRIPT,parseAnnouncement} from './discovery.js';
import {family} from './protocol.js';
import type {Config} from './indexer.js';
/** Public Electrum history is the continuously maintained discovery index. Union
 * observations are hints only. AssetIndexer independently replays every genesis.
 * Cursor is a stable announcement txid; callers restart at the head periodically. */
export async function discoverPublicVaults(p:ElectrumCore,cursor?:string,limit=20){
 if(!Number.isInteger(limit)||limit<1||limit>50||cursor&&!/^[0-9a-f]{64}$/.test(cursor))throw Error('Invalid discovery page');
 const entries=new Map<string,{height:number;peers:string[]}>();let online=0;
 for(const peer of walletPeers(p))try{const history=await p.session(()=>p.history(DISCOVERY_SCRIPT),peer);online++;for(const row of history){const previous=entries.get(row.tx_hash);if(previous)previous.peers.push(peer);else entries.set(row.tx_hash,{height:row.height,peers:[peer]});}}catch{/* The public catalog and saved hints remain usable during outages. */}
 if(!online)throw Error('Public discovery unavailable; retained catalog and saved vaults remain available.');
 const ordered=[...entries].sort((a,b)=>(b[1].height<=0?Number.MAX_SAFE_INTEGER:b[1].height)-(a[1].height<=0?Number.MAX_SAFE_INTEGER:a[1].height)||a[0].localeCompare(b[0]));
 const at=cursor?ordered.findIndex(([id])=>id===cursor)+1:0;if(cursor&&!at)throw Error('Discovery cursor expired; restart from the first page.');
 const page=ordered.slice(at,at+limit),vaults=new Map<string,Config>();let rejected=0;
 for(const [id,entry]of page){let loaded=false;for(const peer of entry.peers)try{
  const configs=await p.session(async()=>{
   const tx=await p.transaction(id),marker=tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===DISCOVERY_SCRIPT);
   if(marker<0||tx.vout[marker].value!==0.00001)throw Error('Missing discovery carrier');
   const script=tx.vout[marker+1]?.scriptPubKey.hex;
   if(typeof script!=='string'||!script.startsWith('6a4c5a')||script.length!==186)throw Error('Missing discovery payload');
   const {parameters,mode}=parseAnnouncement(script.slice(6));
   if(mode==='direct')return [{...parameters,genesis:id}];
   const registry=family(parameters,id,p).registry.lockingBytecode,history=await p.history(registry),found:Config[]=[];
   // Parent announcements remain discoverable before the child propagates. The
   // next refresh reads this history again; a parent alone is never a vault.
   if(history.length>512)throw Error('Registry discovery history exceeds its bounded budget');
   for(const h of history){const child=await p.transaction(h.tx_hash);if(child.vin[0]?.txid===id&&child.vin[0]?.vout===0){found.push({...parameters,genesis:h.tx_hash});break;}}
   return found;
  },peer);
  for(const config of configs)vaults.set(config.genesis,config);loaded=true;break;
 }catch{/* Malformed hints and an unavailable source cannot authorize anything. */}
 if(!loaded)rejected++;
 }
 return {vaults:[...vaults.values()],next:at+page.length<ordered.length?page.at(-1)?.[0]:undefined,observed:entries.size,rejected,online,complete:false};
}
