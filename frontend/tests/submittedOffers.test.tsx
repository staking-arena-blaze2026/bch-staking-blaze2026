import {act,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SubmittedOffers} from '../src/SubmittedOffers';
import {AssetWallet,type Operation} from '../../src/v3/wallet';
import {AssetIndexer,type Snapshot} from '../../src/v3/indexer';
import {reconcileAtomicOffer,offerDisplayStatus,OFFER_RETRY_DELAYS} from '../../src/v3/offer-status';
import {MockNetworkProvider,Network} from 'cashscript';
const config={version:3 as const,registryVersion:4 as const,stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'bch' as const},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n,genesis:'ab'.repeat(32)};
const op:Operation={id:'offer',version:3,kind:'offer',registrationMode:'atomic',step:'action',stage:'pending',raw:'retained-signed-evidence',txid:'47'.repeat(32),source:'c5'.repeat(32),parameters:config,config,terms:{stake:3000n,duration:6144,reward:1000n,maxWins:1},owner:{publicKey:'02'+'11'.repeat(32),path:'receive',index:0},acceptedAt:10000};
const snapshot=(history:string[]=[],pendingHistory:string[]=[],source=op.source)=>({config,instance:{inputs:[{txid:source}]},history,pendingHistory}) as unknown as Snapshot;
afterEach(()=>vi.restoreAllMocks());
it('renders accepted signed evidence immediately, without rank, on the previous state or failed refresh',()=>{
 const view=render(<SubmittedOffers operations={[op]} genesis={config.genesis} snapshot={snapshot()}/>);
 const row=screen.getAllByRole('row')[1];expect(row).toHaveTextContent('Unranked');expect(row).toHaveTextContent('3000 satoshis');expect(row).toHaveTextContent('12 × 512 = 6,144 seconds');expect(row).toHaveTextContent('1000 satoshis');expect(row).toHaveTextContent(op.txid!);expect(row).toHaveTextContent('Pending (0-conf) — awaiting on-chain verification');
 view.rerender(<SubmittedOffers operations={[op]} genesis={config.genesis}/>);expect(screen.getByText(op.txid!)).toBeVisible();
 view.rerender(<SubmittedOffers operations={[op]} genesis={config.genesis} snapshot={snapshot([],[op.txid!],op.txid)}/>);expect(screen.queryByText('Unranked')).toBeNull();
});
it('keeps preparation, wallet refusal and uncertain signing distinct from acceptance',()=>{
 expect(offerDisplayStatus({...op,raw:undefined,txid:undefined,stage:'review',acceptedAt:undefined})).toBe('Prepared but not signed');
 expect(offerDisplayStatus({...op,raw:undefined,signing:'rejected'})).toMatch(/Wallet rejected/);
 expect(offerDisplayStatus({...op,stage:'prepared',acceptedAt:undefined})).toMatch(/^Signed, broadcast status uncertain/);
 expect(offerDisplayStatus({...op,stage:'prepared',acceptedAt:undefined})).not.toMatch(/accepted/);
});
it('retains acceptance during delayed propagation and distinguishes possible eviction after bounded grace',()=>{
 const waiting=reconcileAtomicOffer(op,snapshot(),11000);expect(waiting.observation).toBe('propagating');expect(waiting.acceptedAt).toBe(10000);expect(offerDisplayStatus(waiting)).toMatch(/Broadcast accepted/);
 expect(reconcileAtomicOffer(waiting,snapshot(),130000).observation).toBe('not-observed');
 expect(reconcileAtomicOffer({...op,acceptedAt:undefined,stage:'prepared'},snapshot(),130000).observation).toBe('propagating');
 expect(OFFER_RETRY_DELAYS).toEqual([1000,2000,4000,8000,15000,30000,60000]);
});
it('promotes independent pending and confirmed states, detects reorg, eviction and competing spends without deleting bytes',()=>{
 const pending=reconcileAtomicOffer(op,snapshot([],[op.txid!],op.txid));expect(pending.observation).toBe('pending');
 const confirmed=reconcileAtomicOffer(pending,snapshot([op.txid!],[],op.txid));expect(confirmed.stage).toBe('confirmed');expect(confirmed.step).toBe('complete');
 const reorg=reconcileAtomicOffer(confirmed,snapshot([],[op.txid!],op.txid));expect(reorg.step).toBe('action');expect(reorg.confirmations).toBe(0);
 const evicted=reconcileAtomicOffer(reorg,snapshot());expect(evicted.observation).toBe('not-observed');expect(evicted.raw).toBe(op.raw);
 const conflict=reconcileAtomicOffer(evicted,snapshot(['another'],[],'another'));expect(conflict.stage).toBe('conflicted');expect(conflict.raw).toBe(op.raw);
 expect(reconcileAtomicOffer(conflict,snapshot([],[op.txid!],op.txid)).observation).toBe('pending');
});
it('asymmetric mempools, slow verification and failed refresh cannot declare acceptance or erase signed journals',async()=>{
 let current={...op,stage:'prepared' as const,acceptedAt:undefined};
 const provider=new MockNetworkProvider() as any;provider.network=Network.REGTEST;provider.sendRawTransaction=vi.fn();
 const wallet=new AssetWallet(provider,{list:async()=>[current],save:async value=>{current=value as typeof current;}});
 let release!:(s:Snapshot)=>void;const sync=vi.spyOn(AssetIndexer.prototype,'sync').mockImplementation(()=>new Promise(resolve=>release=resolve));
 const job=wallet.resume(op.id);await Promise.resolve();expect(offerDisplayStatus(current)).toMatch(/uncertain/);release(snapshot([],[op.txid!],op.txid));await job;expect(current.observation).toBe('pending');
 sync.mockRejectedValue(Error('Asymmetric mempools / second provider unavailable'));
 await wallet.resume(op.id);expect(current.observation).toBe('unavailable');expect(current.raw).toBe(op.raw);expect(current.step).toBe('action');expect(current.verifiedAt).toBeDefined();
 expect(reconcileAtomicOffer(current,snapshot()).observation).toBe('not-observed');
 // Repeated reload uses the same retained store, independent of any wallet session.
 const reload=new AssetWallet(provider,wallet.store);await reload.resume(op.id);expect(current.raw).toBe(op.raw);expect(provider.sendRawTransaction).not.toHaveBeenCalled();
 sync.mockResolvedValue(snapshot([op.txid!],[],op.txid));await reload.resume(op.id);expect(current.stage).toBe('confirmed');
});

it('does not treat a rejected broadcast or lost acknowledgement as definitely accepted',()=>{
 const rejected={...op,stage:'prepared' as const,acceptedAt:undefined,error:'txn-mempool-conflict'};
 render(<SubmittedOffers operations={[rejected]} genesis={config.genesis}/>);
 expect(screen.getByText(/Signed, broadcast status uncertain/)).toHaveTextContent('txn-mempool-conflict');
 expect(screen.queryByText(/Broadcast accepted/)).toBeNull();
});
