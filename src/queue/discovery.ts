import {Buffer} from '../bytes.js';
import {binToHex,decodeAuthenticationInstructions,hexToBin} from '@bitauth/libauth';
import type {TransactionBuilder} from 'cashscript';
import type {ElectrumCore} from '../electrum-core.js';
import {utxo} from '../arena-core.js';
import {ancestryVerifier} from '../zero-conf.js';
import {tickContext} from '../consensus-clock.js';
import {discoveryScript,DISCOVERY_CARRIER} from '../v3/discovery.js';
import {v3Network} from '../v3/network.js';
import {parameters,category,type Parameters} from './model.js';
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
/** Announce atomic genesis, using the existing public Electrum marker.
 * There is no additional action/approval and no new registry UTXO. */
export function addAnnouncement(builder:TransactionBuilder,p:ElectrumCore,a:Announcement){builder.addOutput({to:hexToBin(discoveryScript(v3Network(p))),amount:DISCOVERY_CARRIER}).addOpReturnOutput(['0x'+payload(a).toString('hex')]);}
export function announcementIn(tx:any):Announcement|undefined{for(const out of tx.vout){try{const instructions=decodeAuthenticationInstructions(hexToBin(out.scriptPubKey.hex));if(instructions.length!==2||instructions[0]!.opcode!==106||!('data' in instructions[1]!))continue;return parsePayload(binToHex(instructions[1]!.data!));}catch{}}return undefined;}
/** The announcement is carried by genesis itself. Authenticate its entire
 * ancestry and output set before accepting an untrusted discovery hint. */
export async function resolveAnnouncement(p:ElectrumCore,genesisId:string,a:Announcement,deadline=Infinity):Promise<Config|undefined>{
 const checkBudget=()=>{if(Date.now()>=deadline)throw Error('Queue discovery time budget exhausted');};checkBudget();
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),ticks=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...ticks}),created=await ancestry(genesisId),sources=[];
 for(const i of created.vin){checkBudget();sources.push(utxo(await ancestry(i.txid),i.vout));}
 const config:Config={parameters:a.parameters,identity:{vault:created.vin[0]?.txid,queue:a.queue},anchor:{genesis:genesisId,creator:a.creator}};
 authenticateGenesis({p:a.parameters,identity:config.identity,provider:p},config.anchor,created.hex,sources);return config;
}
