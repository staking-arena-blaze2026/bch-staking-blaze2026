/** Synthetic loopback headers/proofs, real queue covenants. Native policy is tested separately. */
import {MockNetworkProvider,Network,SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction,hashTransaction} from '@bitauth/libauth';
import {SettlementChain} from './settlement-chain.js';
import {decodeRawTransaction} from '../../src/electrum-core.js';
import {utxo} from '../../src/arena-core.js';
import * as q from '../../src/queue/protocol.js';
export function queueBrowserChain(){
 const chain=new SettlementChain(),request=chain.request;
 const genesis='01000000'+'00'.repeat(32)+'3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a'+'dae5494d'+'ffff7f20'+'02000000';
 chain.request=async(method,...args)=>method==='blockchain.block.header'&&args[0]===0?genesis:request(method,...args);
 chain.transactionValidator=raw=>{const tx=decodeRawTransaction(raw),sources=tx.vin.map(i=>utxo(chain.transactions.get(i.txid),i.vout)),transaction=q.verify({raw,sources});return {txid:hashTransaction(hexToBin(raw)),fee:sources.reduce((n,u)=>n+u.satoshis,0n)-transaction.outputs.reduce((n,o)=>n+o.valueSatoshis,0n),transaction};};
 const provider=new MockNetworkProvider();provider.network=Network.REGTEST;
 const key=new SignatureTemplate(new Uint8Array(32).fill(86));let counter=1000;
 function add(raw:string){const tx=decodeRawTransaction(raw);chain.transactions.set(tx.txid,tx);chain.pending.add(tx.txid);chain.mine();return tx;}
 function coin(amount:bigint,script=binToHex(q.ownerScript(key.publicKey))){return utxo(add(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:amount,lockingBytecode:hexToBin(script)}]}))),0);}
 const funding=()=>({input:coin(100000n),unlocker:key.unlockP2PKH()});
 const p={stakingCategory:q.ZERO,rewardCategory:q.ZERO,epoch:chain.clock().mtp-10000,interval:60,releases:10,cap:2000n};
 const created=q.create(p,coin(1200n,q.genesis(p,key.publicKey,provider).lockingBytecode),funding(),[],key,provider),tx=add(created.raw),c=created.context;
 const first=q.insert(c,utxo(tx,0),utxo(tx,1),{stake:3000n,duration:512,reward:2000n},key,[funding()]),registered=add(first.raw);
 return {chain,key,config:{parameters:p,identity:c.identity,anchor:{genesis:tx.txid,creator:binToHex(key.publicKey)}},claim(){const claimed=q.remove(c,utxo(registered,0),utxo(registered,2),2,funding(),undefined,undefined,undefined,chain.clock().mtp-1);chain.permittedFees.add(claimed.fee);return chain.request('blockchain.transaction.broadcast',claimed.raw);}};
}
