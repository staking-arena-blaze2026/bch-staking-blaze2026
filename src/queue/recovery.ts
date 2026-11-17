import {decodeTransaction,encodeTransaction,hexToBin,binToHex,hashTransaction} from '@bitauth/libauth';
import type {SpendableUtxo} from 'cashscript';
import {verify} from './protocol.js';
import {cancellationPoint,type Snapshot} from './indexer.js';
export interface Operation {id:string;offerId?:string;kind:'create'|'insert'|'cancel'|'claim'|'withdraw';raw?:string;txid?:string;sources:SpendableUtxo[];status:'review'|'signed'|'pending'|'confirmed'|'conflict';}
export interface Store {save(operation:Operation):Promise<void>}
/** Reject all wallet changes except unlocking witnesses; policy is in signed bytes. */
export function acceptSigned(planned:string,signed:string,sources:SpendableUtxo[],rate=1n){
 const a=decodeTransaction(hexToBin(planned)),b=decodeTransaction(hexToBin(signed));if(typeof a==='string'||typeof b==='string')throw Error('Malformed transaction');
 const strip=(t:typeof a)=>encodeTransaction({...t,inputs:t.inputs.map(i=>({...i,unlockingBytecode:new Uint8Array()}))});
 if(binToHex(strip(a))!==binToHex(strip(b)))throw Error('Wallet changed approved transaction');
 const fee=sources.reduce((n,u)=>n+u.satoshis,0n)-b.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
 if(fee!==BigInt(signed.length/2)*rate)throw Error('Signed fee differs from reviewed network policy');
 verify({raw:signed,sources});return hashTransaction(hexToBin(signed));
}
/** Retain signed evidence before network I/O. A lost acknowledgement can only
 * rebroadcast identical bytes; conflicting signed requests require new approval. */
export async function submit(op:Operation,store:Store,broadcast:(raw:string)=>Promise<string>){if(!op.raw)throw Error('Unsigned operation');const txid=hashTransaction(hexToBin(op.raw)),signed={...op,txid,status:'signed' as const};verify({raw:op.raw,sources:op.sources});await store.save(signed);const sent=await broadcast(op.raw);if(sent!==txid)throw Error('Broadcast transaction identity mismatch');const pending={...signed,status:'pending' as const};await store.save(pending);return pending;}
export function refreshCancellation(op:Operation,s:Snapshot){if(op.raw)throw Error('Retain signed bytes; rebuild only as a new approved operation');if(!op.offerId)throw Error('Missing stable offer identifier');return cancellationPoint(s,op.offerId);}
