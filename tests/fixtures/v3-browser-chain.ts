/** Synthetic linked headers/Merkle proofs with real compiled v3 VM validation.
 * This fixture is loopback-only; BCHN consensus integration is tested separately. */
import {MockNetworkProvider,Network,SignatureTemplate} from 'cashscript';
import {binToHex,hexToBin,encodeTransaction} from '@bitauth/libauth';
import {SettlementChain} from './settlement-chain.js';
import {decodeRawTransaction} from '../../src/electrum-core.js';
import {utxo} from '../../src/arena-core.js';
import {walletScript} from '../../src/transactions-core.js';
import {validateBuilt,covenant,parameterArgs,genesisBuilder,transitionBuilder,family,type Parameters,type Instance} from '../../src/v3/protocol.js';
const regtestGenesis='01000000'+'00'.repeat(32)+'3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a'+'dae5494d'+'ffff7f20'+'02000000';
export function v3BrowserChain(network:Network=Network.REGTEST){
 const chain=new SettlementChain(),request=chain.request;
 chain.request=async(method,...params)=>network===Network.REGTEST&&method==='blockchain.block.header'&&params[0]===0?regtestGenesis:request(method,...params);
 chain.transactionValidator=(raw,_sources,clock)=>{const tx=decodeRawTransaction(raw),inputs=tx.vin.map(i=>utxo(chain.transactions.get(i.txid),i.vout)),height=chain.confirmed.get(inputs[0]!.txid),anchor=height===undefined?undefined:height-1;const sourceMtp=anchor===undefined?undefined:Array.from({length:11},(_,i)=>Buffer.from(chain.headers.get(anchor-10+i)!,'hex').readUInt32LE(68)).sort((a,b)=>a-b)[5];return validateBuilt(raw,inputs,clock,sourceMtp);};
 const provider=new MockNetworkProvider();provider.network=network;
 const key=new SignatureTemplate(new Uint8Array(32).fill(86)),script=walletScript(binToHex(key.publicKey));let counter=1000;
 function add(raw:string,mine=true){const tx=decodeRawTransaction(raw);chain.transactions.set(tx.txid,tx);chain.pending.add(tx.txid);if(mine)chain.mine();return tx;}
 function coin(amount:bigint,locking=script,mine=true){return utxo(add(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:hexToBin((++counter).toString(16).padStart(64,'0')),outpointIndex:1,sequenceNumber:0xfffffffe,unlockingBytecode:new Uint8Array()}],outputs:[{valueSatoshis:amount,lockingBytecode:hexToBin(locking)}]})),mine),0);}
 const parameters:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:chain.clock().mtp-10000,periodSeconds:100,periods:4,cap:2000n};
 const factory=covenant('RegistryGenesisV3',parameterArgs(parameters),provider),funding=coin(12000n,factory.lockingBytecode),reserve=coin(9000n);
 const g=genesisBuilder(parameters,funding,{input:reserve,unlocker:key.unlockP2PKH()},provider),genesis=add(g.builder.build());
 const v:Instance={parameters,category:funding.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]};
 const stake=coin(6000n),fee=coin(10000n),offer=transitionBuilder(v,0,0,provider,chain.clock(),{input:fee,unlocker:key.unlockP2PKH()},key,{owner:key.publicKey,terms:{stake:3000n,duration:512,reward:2000n,maxWins:2},funding:{input:stake,unlocker:key.unlockP2PKH()}});
 const registered=add(offer.builder.build());
 const caller=new SignatureTemplate(new Uint8Array(32).fill(94)),callerInput=coin(12000n,walletScript(binToHex(caller.publicKey)));
 return {chain,key,coin,add,provider,config:{...parameters,genesis:genesis.txid},async claim(){const current={...v,state:offer.state,inputs:[utxo(registered,0),utxo(registered,1),utxo(registered,2)] as Instance['inputs']},built=transitionBuilder(current,3,0,provider,chain.clock(),{input:callerInput,unlocker:caller.unlockP2PKH()},undefined,undefined,{address:(await import('../../src/v3/protocol.js')).ownerAddress(caller.publicKey,provider)});return chain.request('blockchain.transaction.broadcast',built.builder.build());}};
}
