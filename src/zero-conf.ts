import {createVirtualMachineBch2026,decodeTransaction,hexToBin} from '@bitauth/libauth';
import type {ElectrumCore} from './electrum-core.js';
import {utxo} from './arena-core.js';
import type {KeeperClock} from './keeper-core.js';

/** Bounded, session-local ancestry validation. Providers attest mempool presence, never finality.
 * Confirmed boundaries retain ElectrumCore's Merkle/header checks. No cached trust crosses sessions.
 * BCHN has no ancestor-count policy limit; these are application resource limits.
 */
export function ancestryVerifier(p:ElectrumCore,clock:KeeperClock){
 const histories=new Map<string,Promise<import('./electrum-core.js').HistoryEntry[]>>(),raws=new Map<string,Promise<any>>();
 const historyFor=(script:string)=>{if(!histories.has(script))histories.set(script,p.history(script));return histories.get(script)!;};
 const rawFor=(id:string)=>{if(!raws.has(id))raws.set(id,p.transaction(id));return raws.get(id)!;};
 const checked=new Map<string,any>(),visiting=new Set<string>(),spends=new Map<string,string>();
 let count=0,bytes=0;
 const load=async(id:string):Promise<any>=>{
  if(checked.has(id))return checked.get(id);
  if(checked.size+visiting.size>=1024)throw Error('Ancestry exceeds total source transaction budget (1024)');
  if(visiting.has(id))throw Error('Cyclic unconfirmed ancestry');
  if(visiting.size>=256)throw Error('Unconfirmed ancestry exceeds application depth limit (256)');
  visiting.add(id);
  const tx=await p.transactionStatus(id);
  if(tx.confirmations>0){checked.set(id,tx);visiting.delete(id);return tx;}
  if(++count>256||(bytes+=tx.hex.length/2)>4_000_000)throw Error('Unconfirmed ancestry exceeds application validation budget');
  const decoded=decodeTransaction(hexToBin(tx.hex));if(typeof decoded==='string')throw Error(decoded);
  if((decoded.version!==1&&decoded.version!==2)||decoded.locktime>=(decoded.locktime<500000000?clock.height+1:clock.mtp))throw Error('Non-final unconfirmed ancestor');
  const sources=[];
  for(const [n,input]of tx.vin.entries()){
   const outpoint=input.txid+':'+input.vout;
   if(spends.has(outpoint)&&spends.get(outpoint)!==id)throw Error('Conflicting unconfirmed ancestry');
   spends.set(outpoint,id);
   const parent=await load(input.txid),source=utxo(parent,input.vout);
   if(parent.vin.length===1&&parent.vin[0].vout===0xffffffff&&/^0+$/.test(parent.vin[0].txid)&&parent.confirmations<100)throw Error('Immature coinbase ancestor');
   // Relative locks against unconfirmed outputs cannot have matured. Absolute time/height
   // locks and confirmed relative locks remain subject to node policy at broadcast.
   const sequence=decoded.inputs[n]!.sequenceNumber;
   if(!(sequence&0x80000000)&&(sequence&0xffff)>0){
    if(parent.confirmations<=0)throw Error('Unconfirmed relative-lock ancestor');
    const units=sequence&0xffff;
    if(sequence&0x400000){const anchor=await p.header(Math.max(0,parent.height-1));if(clock.mtp<await p.medianTime(anchor.height,anchor.hash)+units*512)throw Error('Immature ancestor time lock');}
    else if(clock.height+1<parent.height+units)throw Error('Immature ancestor height lock');
   }
   // An ancestor's input is already spent by it: inspect histories rather than listunspent.
   const history=await historyFor(source.lockingBytecode!);
   if(!history.some(h=>h.tx_hash===id&&h.height<=0))throw Error('Unconfirmed ancestor missing from input history');
   for(const h of history){
    if(h.tx_hash===id||h.tx_hash===input.txid)continue;
    const candidate=await rawFor(h.tx_hash);
    if(candidate.vin.some((i:any)=>i.txid===input.txid&&i.vout===input.vout))throw Error('Known double-spend conflict in ancestor history');
   }
   sources.push({valueSatoshis:source.satoshis,lockingBytecode:hexToBin(source.lockingBytecode!),...(source.token?{token:{category:hexToBin(source.token.category),amount:source.token.amount,...(source.token.nft?{nft:{capability:source.token.nft.capability,commitment:hexToBin(source.token.nft.commitment)}}:{})}}:{})});
  }
  const valid=createVirtualMachineBch2026().verify({transaction:decoded,sourceOutputs:sources});
  if(valid!==true)throw Error('Invalid unconfirmed ancestor (scripts/tokens/value): '+valid);
  checked.set(id,tx);visiting.delete(id);return tx;
 };
 return Object.assign(load,{evidence:checked});
}
