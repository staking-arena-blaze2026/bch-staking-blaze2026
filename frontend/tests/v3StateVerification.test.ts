import {expect,it,vi} from 'vitest';
import {MockNetworkProvider,Network} from 'cashscript';
import {AssetWallet,type Operation} from '../../src/v3/wallet';
import {AssetIndexer,type Snapshot} from '../../src/v3/indexer';
import {initialState} from '../../src/v3/model';
import {walletScript,type WalletKey} from '../../src/transactions-core';
import {scanWallet,verifyCoinsAcrossPeers} from '../../src/electrum-wallet';
import type {ElectrumCore} from '../../src/electrum-core';
vi.mock('../../src/electrum-wallet',async original=>({...await original<typeof import('../../src/electrum-wallet')>(),scanWallet:vi.fn(),verifyCoinsAcrossPeers:vi.fn()}));
vi.mock('../../src/v3/funding-discovery',()=>({discoverFunding:async(...args:unknown[])=>vi.mocked(scanWallet)(...(args.slice(0,2) as [ElectrumCore,WalletKey[]]))}));
const config={version:3 as const,stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'bch' as const},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n,genesis:'ab'.repeat(32)};
function setup(){
 const owner:WalletKey={publicKey:'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',path:'receive',index:0},provider=new MockNetworkProvider() as unknown as ElectrumCore;
 provider.network=Network.REGTEST;
 const snapshot={config,instance:{parameters:config,state:initialState(config),inputs:[{txid:'cd'.repeat(32)}]},pending:[],allocations:[],clock:{height:100,mtp:1800010000}} as unknown as Snapshot;
 const sync=vi.spyOn(AssetIndexer.prototype,'sync').mockResolvedValue(snapshot);
 vi.mocked(scanWallet).mockResolvedValue({coins:[{...owner,utxo:{txid:'ef'.repeat(32),vout:0,satoshis:100000n,lockingBytecode:walletScript(owner.publicKey)}}]} as any);
 vi.mocked(verifyCoinsAcrossPeers).mockResolvedValue(snapshot.clock as any);
 const journal=new Map<string,Operation>(),wallet=new AssetWallet(provider,{list:async()=>[...journal.values()],save:async op=>{journal.set(op.id,op);}});
 return {wallet,snapshot,sync,owner,journal};
}
it('refreshes canonical state before offer funding and again before approval; rejects a changed source',async()=>{
 const {wallet,snapshot,sync,owner,journal}=setup();
 const op=await wallet.offer(config,{stake:3000n,duration:3600,reward:1000n,maxWins:1},[owner]);expect(sync).toHaveBeenCalledTimes(1);expect(op.source).toBe('cd'.repeat(32));
 await wallet.authorize(op.id);expect(sync).toHaveBeenCalledTimes(2);
 sync.mockResolvedValue({...snapshot,instance:{...snapshot.instance,inputs:[{txid:'aa'.repeat(32)}] as any}});
 await expect(wallet.authorize(op.id)).rejects.toThrow(/state changed/);expect(journal.get(op.id)?.raw).toBeUndefined();
 await expect(wallet.submit(op.id,'stale signed bytes')).rejects.toThrow(/state changed/);
});
it('rejects pending state and capacity exhaustion during fresh offer verification',async()=>{
 const {wallet,snapshot,sync,owner}=setup(),terms={stake:3000n,duration:3600,reward:1000n,maxWins:1};
 sync.mockResolvedValue({...snapshot,pending:['pending']});await expect(wallet.offer(config,terms,[owner])).rejects.toThrow(/pending spends/);
 snapshot.instance.state[5]=16;sync.mockResolvedValue(snapshot);await expect(wallet.offer(config,terms,[owner])).rejects.toThrow(/Registration is closed/);
});

it('new wallet offers enforce one win and fund exactly S; tagged plans cannot change that limit',async()=>{
 const {wallet,owner,journal}=setup(),terms={stake:3000n,duration:3600,reward:1000n,maxWins:1};
 await expect(wallet.offer(config,{...terms,maxWins:2},[owner])).rejects.toThrow(/exactly one/);expect(journal.size).toBe(0);
 const op=await wallet.offer(config,terms,[owner]);expect(op.terms?.maxWins).toBe(1);expect(op.offerPolicy).toBe('single-win');expect(op.plan?.request.transaction.outputs[0]?.valueSatoshis).toBe(3000n);
 op.terms!.maxWins=2;await expect(wallet.authorize(op.id)).rejects.toThrow(/exactly one/);
});
