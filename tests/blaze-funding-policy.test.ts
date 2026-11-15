import test from 'node:test';
import assert from 'node:assert/strict';
import {SignatureTemplate} from 'cashscript';
import {chooseBch,chooseTokens} from '../src/electrum-wallet.js';
import {FundingSelectionError,MAX_FUNDING_INPUTS} from '../src/wallet-funding-policy.js';
import {fundingReport,reservesFunding} from '../src/v3/funding-report.js';
import type {Operation} from '../src/v3/wallet.js';
import {walletScript,type WalletCoin} from '../src/transactions-core.js';
const publicKey=Buffer.from(new SignatureTemplate(new Uint8Array(32).fill(78)).publicKey).toString('hex');
const coin=(value:bigint,index=1):WalletCoin=>({publicKey,path:index%2?'receive':'change',index:0,utxo:{txid:index.toString(16).padStart(64,'0'),vout:1,satoshis:value,lockingBytecode:walletScript(publicKey)}});
test('single large and several small coins select efficiently without unnecessary small inputs',()=>{
 const coins=[coin(1000n),coin(50000n,2),coin(33000n,3)];assert.equal(chooseBch(coins,33000n).length,1);
 assert.equal(chooseBch([coin(11000n,1),coin(11000n,2),coin(11000n,3)],33000n).length,3);
});
test('812333 sat fragmented wallet reproduces former eight-input failure, now funds chained parent',()=>{
 const coins=Array.from({length:300},(_,i)=>coin(2700n,i+1));coins.push(coin(2333n,301));
 assert.equal(coins.reduce((n,c)=>n+c.utxo.satoshis,0n),812333n);
 const selected=chooseBch(coins,33000n);assert.equal(selected.length,13);assert.equal(selected.reduce((n,c)=>n+c.utxo.satoshis,0n),35100n);
 // Former code threw despite having all 812333 sats already discovered at the first address.
 assert.ok(selected.length>8);
});
test('balance and size/input limits are distinct errors',()=>{
 assert.throws(()=>chooseBch([coin(1000n)],33000n),(e:unknown)=>e instanceof FundingSelectionError&&e.code==='balance');
 assert.throws(()=>chooseBch(Array.from({length:MAX_FUNDING_INPUTS+1},(_,i)=>coin(1000n,i)),BigInt(MAX_FUNDING_INPUTS+1)*1000n),(e:unknown)=>e instanceof FundingSelectionError&&e.code==='input-limit');
});
test('token-free BCH preferred and NFT/unrelated token carriers never fund BCH-only creation',()=>{
 const token={...coin(500000n,2),utxo:{...coin(500000n,2).utxo,token:{category:'ab'.repeat(32),amount:10n}}};
 assert.deepEqual(chooseBch([token,coin(50000n)],33000n),[coin(50000n)]);
 assert.throws(()=>chooseTokens([token], 'cd'.repeat(32),1n),/eligible fungible/);
});
test('reservation lifecycle retains unknown signatures and legacy status; releases known unsigned/refused/completed plans',()=>{
 const op={step:'action',stage:'review',signing:'unsigned'} as Operation;
 assert.equal(reservesFunding(op),false);assert.equal(reservesFunding({...op,signing:'requested'}),true);
 assert.equal(reservesFunding({...op,signing:undefined}),true);assert.equal(reservesFunding({...op,signing:'rejected'}),false);
 assert.equal(reservesFunding({...op,signing:'rejected',raw:'signed'}),true);
 assert.equal(reservesFunding({...op,raw:'signed',step:'complete',stage:'confirmed'}),true);
 assert.equal(reservesFunding({...op,raw:'signed',stage:'conflicted'}),true);
});
test('structured report explains reserved, unsigned, token carriers and confirmation status without logging addresses',()=>{
 const coins=[coin(40000n,1),coin(30000n,2),coin(20000n,3)];Object.assign(coins[0]!.utxo,{height:1});Object.assign(coins[1]!.utxo,{height:0});
 const report=fundingReport(coins,[coins[0]!],new Set([coins[0]!.utxo.txid+':1']),new Set([coins[1]!.utxo.txid+':1']));
 assert.equal(report.total,'90000');assert.equal(report.available,'50000');assert.equal(report.reserved,'40000');assert.equal(report.unsignedReleased,'30000');assert.equal(report.confirmed,'40000');assert.equal(report.unconfirmed,'30000');assert.equal(report.unclassified,'20000');
});
