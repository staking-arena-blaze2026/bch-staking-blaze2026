import {creationSequence} from '../src/queue/preparation.js';
import {ZERO,ownerScript} from '../src/queue/protocol.js';
import {policyRate} from '../src/queue/fees.js';
/** Read-only public evidence. Broadcast is disabled; no wallet/session access. */
import {ElectrumProvider} from '../src/electrum.js';
import {verifyCoins} from '../src/electrum-wallet.js';
import {binToHex,hexToBin,cashAddressToLockingBytecode} from '@bitauth/libauth';
const address=process.argv[2],txid=process.argv[3];
if(!address||!txid||!/^[a-f0-9]{64}$/.test(txid))throw Error('Usage: inspect-queue-funding.ts <public address> <transaction id>');
const decoded=cashAddressToLockingBytecode(address);if(typeof decoded==='string')throw Error(decoded);
const script=binToHex(decoded.bytecode),p=new ElectrumProvider({network:'mainnet',allowBroadcast:false,timeoutMs:15000});
for(const peer of p.endpoints)try{
 console.log(JSON.stringify(await p.session(async()=>{
  const tip=await p.tip(),coins=await p.getUtxosForLockingBytecode(script);await verifyCoins(p,coins,peer,true);
  let old:any;try{const tx=await p.transactionStatus(txid);old={txid,height:tx.height,confirmations:tx.confirmations,inputs:[],outputs:tx.vout.map((o:any)=>({vout:o.n,satoshis:o.satoshis,script:o.scriptPubKey.hex,token:o.tokenData}))};
   for(const i of tx.vin){const parent=await p.transaction(i.txid),output=parent.vout[i.vout],unspent=await p.getUtxosForLockingBytecode(output.scriptPubKey.hex);old.inputs.push({txid:i.txid,vout:i.vout,satoshis:output.satoshis,stillUnspent:unspent.some(u=>u.txid===i.txid&&u.vout===i.vout)});}
   for(const o of old.outputs){const cs=await p.getUtxosForLockingBytecode(o.script);await verifyCoins(p,cs,peer,true);o.currentUtxos=cs;}
   const publicKey=tx.vin[0]?.scriptSig.hex.slice(-66);
   if(publicKey&&/^0[23][a-f0-9]{64}$/.test(publicKey)){
    const owner={publicKey,path:'receive' as const,index:0},lockingBytecode=binToHex(ownerScript(hexToBin(publicKey)));
    const cs=await p.getUtxosForLockingBytecode(lockingBytecode);await verifyCoins(p,cs,peer,true);
    const rate=policyRate(await p.request('blockchain.relayfee'));
    old.projection={assumption:'matching public key must be exposed by the live wallet descriptor; path/index here are sizing placeholders, not verified derivation evidence',rate:rate.toString(),quote:creationSequence({stakingCategory:ZERO,rewardCategory:ZERO,epoch:tip.time+3600,interval:600,releases:8,cap:1200n},cs.map(utxo=>({...owner,utxo})),owner,p,rate).quote};
   }
  }catch(e){old={txid,error:String(e)};}
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed; rerun');
  return {at:new Date().toISOString(),peer,tip:{height:tip.height,hash:tip.hash},verifiedAddressUtxos:coins,bch:coins.reduce((n,c)=>n+c.satoshis,0n).toString(),old};
 },peer),(_,v)=>typeof v==='bigint'?v.toString():v));
}catch(e){console.log(JSON.stringify({peer,error:String(e)}));}
