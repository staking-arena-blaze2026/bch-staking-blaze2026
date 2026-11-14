import test from 'node:test';
import assert from 'node:assert/strict';
import {binToHex,encodeTransaction} from '@bitauth/libauth';
import {decodeRawTransaction,type ElectrumCore} from '../src/electrum-core.js';
import {verifyCoins} from '../src/electrum-wallet.js';
import {utxo} from '../src/arena-core.js';

test('v3 rejects immature coinbase sources without changing legacy verification rules',async()=>{
 const tx=decodeRawTransaction(binToHex(encodeTransaction({version:2,locktime:0,inputs:[{outpointTransactionHash:new Uint8Array(32),outpointIndex:0xffffffff,sequenceNumber:0xffffffff,unlockingBytecode:Uint8Array.of(1,1)}],outputs:[{lockingBytecode:Uint8Array.of(81),valueSatoshis:100000n}]})));
 let confirmations=99;const coin=utxo(tx,0),provider={async tip(){return {height:200,hash:'tip'};},async medianTime(){return 1800000000;},async getUtxosForLockingBytecode(){return [coin];},async transactionStatus(){return {...tx,height:102,confirmations};}} as unknown as ElectrumCore;
 await assert.rejects(()=>verifyCoins(provider,[coin],'test',true),/Immature coinbase input/);
 await verifyCoins(provider,[coin],'test');
 confirmations=100;await verifyCoins(provider,[coin],'test',true);
});
