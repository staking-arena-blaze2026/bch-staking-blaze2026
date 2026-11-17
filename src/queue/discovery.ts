import {Buffer} from '../bytes.js';
import {binToHex,decodeAuthenticationInstructions,hexToBin} from '@bitauth/libauth';
import type {TransactionBuilder} from 'cashscript';
import type {ElectrumCore} from '../electrum-core.js';
import {utxo} from '../arena-core.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {discoveryScript,DISCOVERY_CARRIER} from '../v3/discovery.js';
import {v3Network} from '../v3/network.js';
import {parameters,category,ZERO,type Parameters,type Identity} from './model.js';
import {genesis} from './protocol.js';
import {authenticateGenesis} from './indexer.js';
import type {Config} from './chain.js';
const MAGIC=Buffer.from('ARENAQUEUE','ascii');
export interface Announcement {parameters:Parameters;creator:string;queue:string}
export function payload(a:Announcement){const {assets,schedule}=parameters(a.parameters);if(!/^(02|03)[a-f0-9]{64}$/.test(a.creator))throw Error('Invalid creator');return Buffer.concat([MAGIC,assets,schedule,Buffer.from(a.creator,'hex'),category(a.queue)]);}
export function parsePayload(hex:string):Announcement{
 const b=Buffer.from(hex,'hex'),at=MAGIC.length;if(b.length!==at+145||!b.subarray(0,at).equals(MAGIC))throw Error('Not a queue announcement');
 const c=(offset:number)=>Buffer.from(b.subarray(offset,offset+32)).reverse().toString('hex');
 const p:Parameters={stakingCategory:c(at),rewardCategory:c(at+32),epoch:b.readUInt32LE(at+64),interval:b.readUInt32LE(at+68),releases:b.readUInt32LE(at+72),cap:BigInt(b.readUInt32LE(at+76))};parameters(p);
 const result={parameters:p,creator:b.subarray(at+80,at+113).toString('hex'),queue:c(at+113)};if(!payload(result).equals(b))throw Error('Noncanonical queue announcement');return result;
}
/** Announce the seed preparation, using the existing public Electrum marker.
 * There is no additional action/approval and no new registry UTXO. */
export function addAnnouncement(builder:TransactionBuilder,p:ElectrumCore,a:Announcement){builder.addOutput({to:hexToBin(discoveryScript(v3Network(p))),amount:DISCOVERY_CARRIER}).addOpReturnOutput(['0x'+payload(a).toString('hex')]);}
export function announcementIn(tx:any):Announcement|undefined{for(const out of tx.vout){try{const instructions=decodeAuthenticationInstructions(hexToBin(out.scriptPubKey.hex));if(instructions.length!==2||instructions[0]!.opcode!==106||!('data' in instructions[1]!))continue;return parsePayload(binToHex(instructions[1]!.data!));}catch{}}return undefined;}
/** Resolve only a canonical spend of this seed. Announcements remain untrusted
 * routing hints until the complete genesis and its sources authenticate. */
export async function resolveAnnouncement(p:ElectrumCore,seedId:string,a:Announcement,deadline=Infinity):Promise<Config|undefined>{
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),seed=await ancestry(seedId),factory=genesis(a.parameters,hexToBin(a.creator),p);
 if(seed.vout[0]?.scriptPubKey.hex!==factory.lockingBytecode||seed.vout[0]?.tokenData)throw Error('Announcement seed mismatch');
 const candidates=[];const checkBudget=()=>{if(Date.now()>=deadline)throw Error('Queue discovery time budget exhausted');};checkBudget();
 for(const row of await p.history(factory.lockingBytecode)){checkBudget();if(row.tx_hash===seedId)continue;const tx=await p.transaction(row.tx_hash);if(tx.vin[0]?.txid!==seedId||tx.vin[0]?.vout!==0||tx.vin[1]?.txid!==a.queue||tx.vin[1]?.vout!==0)continue;const checked=await ancestry(row.tx_hash,row),sources=[];for(const i of checked.vin){checkBudget();sources.push(utxo(await ancestry(i.txid),i.vout));}const config:Config={parameters:a.parameters,identity:{vault:seedId,queue:a.queue},anchor:{genesis:checked.txid,creator:a.creator}};
  try{authenticateGenesis({p:a.parameters,identity:config.identity,provider:p},config.anchor,checked.hex,sources);candidates.push(config);}catch{/* A refund or malformed candidate cannot become a vault. */}
 }
 if(candidates.length>1)throw Error('Conflicting queue genesis candidates');return candidates[0];
}
