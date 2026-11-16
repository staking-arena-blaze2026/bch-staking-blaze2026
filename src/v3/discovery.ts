import {binToHex,hexToBin,hash160,encodeCashAddress} from '@bitauth/libauth';
import {Network,type TransactionBuilder,type NetworkProvider} from 'cashscript';
import {Buffer} from '../bytes.js';
import {v3Network,type V3Network} from './network.js';
import {validateParameters,type Parameters} from './model.js';
// A spendable public P2SH marker is indexed by ordinary Electrum history. OP_RETURN
// alone is deliberately not used as an index key (servers may exclude it).
const markerHash=hash160(hexToBin('51'));
export const DISCOVERY_SCRIPT='a914'+binToHex(markerHash)+'87';
/** Network-specific, anyone-spendable P2SH: push UTF-8 namespace, DROP, TRUE.
 * Same 23-byte output and carrier; the redeem script is public and deterministic. */
export function discoveryRedeem(network:V3Network){const tag=Buffer.from('StakingArena/BLAZE/discovery/v2/'+network);return Buffer.concat([Buffer.from([tag.length]),tag,Buffer.from('7551','hex')]);}
export function discoveryScript(network:V3Network){return 'a914'+binToHex(hash160(discoveryRedeem(network)))+'87';}
export function discoveryScripts(network:V3Network){return [discoveryScript(network),DISCOVERY_SCRIPT];}
export const DISCOVERY_CARRIER=1000n;
const MAGIC=Buffer.from('BLAZEIDX','ascii');
export function announcement(p:Parameters,mode:'direct'|'parent'){
 validateParameters(p);const extended=p.periods>16,b=Buffer.alloc(extended?91:90);MAGIC.copy(b);b[8]=extended?2:1;b[9]=mode==='direct'?0:1;b[10]=p.registryVersion===4?4:3;
 for(const [at,asset]of [[11,p.stakingAsset],[44,p.rewardAsset]] as const){b[at]=asset.kind==='token'?1:0;if(asset.kind==='token')Buffer.from(asset.category,'hex').copy(b,at+1);}
 b.writeUInt32LE(p.epoch,77);b.writeUInt32LE(p.periodSeconds,81);if(extended)b.writeUInt16LE(p.periods,85);else b[85]=p.periods;
 b.writeUInt32LE(Number(p.cap),extended?87:86);return b;
}
export function parseAnnouncement(hex:string):{parameters:Parameters;mode:'direct'|'parent'}{
 const b=Buffer.from(hex,'hex');if(!((b[8]===1&&b.length===90)||(b[8]===2&&b.length===91))||!b.subarray(0,8).equals(MAGIC)||b[9]!>1||![3,4].includes(b[10]!))throw Error('Unsupported discovery announcement');
 const asset=(at:number)=>{if(b[at]===0){if(b.subarray(at+1,at+33).some(v=>v!==0))throw Error('Noncanonical BCH asset');return {kind:'bch' as const};}if(b[at]!==1)throw Error('Invalid asset tag');return {kind:'token' as const,category:b.subarray(at+1,at+33).toString('hex')};};
 const parameters=validateParameters({version:3,discovery:1,...(b[10]===4?{registryVersion:4 as const}:{}),stakingAsset:asset(11),rewardAsset:asset(44),epoch:b.readUInt32LE(77),periodSeconds:b.readUInt32LE(81),periods:b[8]===2?b.readUInt16LE(85):b[85]!,cap:BigInt(b.readUInt32LE(b[8]===2?87:86))});
 if((b[8]===1&&parameters.periods>16)||(b[8]===2&&parameters.periods<=16))throw Error('Noncanonical release count encoding');
 return {parameters,mode:b[9]===0?'direct':'parent'};
}
export const announcementScript=(p:Parameters,mode:'direct'|'parent')=>{const payload=announcement(p,mode);return '6a4c'+payload.length.toString(16)+payload.toString('hex');};
export function addAnnouncement(builder:TransactionBuilder,p:Parameters,mode:'direct'|'parent',provider:NetworkProvider){
 if(p.discovery!==1)return;
 const address=encodeCashAddress({prefix:provider.network===Network.MAINNET?'bitcoincash':provider.network===Network.REGTEST?'bchreg':'bchtest',type:'p2sh',payload:hash160(discoveryRedeem(v3Network(provider)))});if(typeof address==='string')throw Error(address);
 builder.addOutput({to:address.address,amount:DISCOVERY_CARRIER}).addOpReturnOutput(['0x'+announcement(p,mode).toString('hex')]);
}
