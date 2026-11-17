import {withdrawalBuilder,covenant,validateBuilt,FEE} from '../../src/v3/protocol';
import {walletScript} from '../../src/transactions-core';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {Buffer} from '../../src/bytes';
import {initialState,advance} from '../../src/v3/model';
import {allocationTerms} from '../../src/registry';
import {ownedOffers,offerActionIntent} from '../../src/v3/my-offers';
import {AssetIndexer,type Snapshot} from '../../src/v3/indexer';
import {AssetWallet,type Operation} from '../../src/v3/wallet';
import {canDiscardUnsigned,blocksVault} from '../../src/v3/recovery-policy';
import {MockNetworkProvider,Network,SignatureTemplate} from 'cashscript';
import {MyOffers} from '../src/MyOffers';
import {lastOfferOwner,rememberOfferOwner} from '../src/offerIdentity';
const owner='02'+'11'.repeat(32),other='03'+'22'.repeat(32);
const config={version:3 as const,registryVersion:4 as const,stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'bch' as const},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n,genesis:'ab'.repeat(32)};
function record(key=owner,maxWins=1){const r=Buffer.alloc(49);r.set(Buffer.from(key,'hex'));r.writeUInt32LE(3000,33);r.writeUInt32LE(3600,37);r.writeUInt32LE(1000,41);r[45]=maxWins;return r;}
function snapshot(wins=0,maxWins=1):Snapshot{
 let state=advance(initialState(config),0,0,record(owner,maxWins));state=advance(state,0,1,record(other));
 for(let i=0;i<wins;i++)state=advance(state,3,0);
 return {config,instance:{state,inputs:[]},clock:{mtp:1800000000,height:100},pending:[],pendingHistory:[],history:[],offerHistory:[],allocations:Array.from({length:wins},(_,i)=>({id:'win'+i+':4',terms:allocationTerms(Buffer.from(owner,'hex'),'aa'.repeat(32),'00'.repeat(32),0,i,3000,0x400008),input:{txid:'win'+i,vout:4,satoshis:3000n},mature:false,sourceMtp:1800000000}))} as unknown as Snapshot;
}
const base:Operation={id:'unsigned',version:3,kind:'offer',step:'action',stage:'review',signing:'unsigned',owner:{publicKey:owner,path:'receive',index:0},parameters:config,config};
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();});
it('derives exactly five statuses and never treats pending withdrawal or elapsed wall time as Finished',()=>{
 expect(ownedOffers(snapshot(),owner)[0].status).toBe('ACTIVE');
 const won=snapshot(1);expect(ownedOffers(won,owner)[0].status).toBe('WON / LOCKED');
 vi.setSystemTime(new Date('2099-01-01'));expect(ownedOffers(won,owner)[0].status).toBe('WON / LOCKED');vi.useRealTimers();
 won.allocations[0].mature=true;expect(ownedOffers(won,owner)[0].status).toBe('BAKED');
 won.allocations[0].pending='pending';expect(ownedOffers(won,owner)[0].status).toBe('BAKED');
 won.allocations[0].withdrawal='confirmed';expect(ownedOffers(won,owner)[0].status).toBe('FINISHED');
 const cancelled=snapshot();cancelled.instance.state=advance(cancelled.instance.state,1,0);expect(ownedOffers(cancelled,owner)[0]).toMatchObject({recovery:true,status:'ACTIVE'});
 cancelled.instance.state=advance(cancelled.instance.state,4,0);expect(ownedOffers(cancelled,owner)[0]).toMatchObject({recovery:false,status:'CANCELLED'});
 cancelled.offerHistory=[{slot:0,action:4,txid:'pending-refund',pending:true}];expect(ownedOffers(cancelled,owner)[0].status).not.toBe('CANCELLED');
});
it('filters canonical owners across vaults, supports offline identity and switches wallets without journal discovery',()=>{
 rememberOfferOwner(owner,'mainnet');rememberOfferOwner(other,'chipnet');expect(lastOfferOwner('mainnet')).toBe(owner);expect(lastOfferOwner('chipnet')).toBe(other);
 const s=snapshot(),s2={...snapshot(),config:{...config,genesis:'cd'.repeat(32)}};
 const props={listings:{one:{snapshot:s,at:1},two:{snapshot:s2,at:1}},busy:false,operations:[],act:vi.fn()};
 const view=render(<MyOffers {...props} owner={owner} live={false}/>);expect(screen.getByText(/Last connected wallet/)).toHaveTextContent(owner);expect(screen.getAllByText(/Offer 1/)).toHaveLength(2);expect(screen.queryByText(/Offer 2/)).toBeNull();
 view.rerender(<MyOffers {...props} owner={other} live/>);expect(screen.getByText(/Connected wallet/)).toHaveTextContent(other);expect(screen.getAllByText(/Offer 2/)).toHaveLength(2);expect(screen.queryByText(/Offer 1/)).toBeNull();
 expect(ownedOffers(s,'bad')).toEqual([]);
});
it('only offers Cancel while active, and keeps offline withdrawal visible at verified maturity',()=>{
 const locked=snapshot(1),props={owner,live:false,busy:false,operations:[],act:vi.fn()};
 const view=render(<MyOffers {...props} listings={{one:{snapshot:locked,at:1}}}/>);expect(screen.queryByRole('button')).toBeNull();
 locked.allocations[0].mature=true;view.rerender(<MyOffers {...props} listings={{one:{snapshot:locked,at:1}}}/>);expect(screen.getByRole('button',{name:'Get my stake back'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();
});
it('validates cancellation ownership, refuses won offers, and resumes interrupted unused commitment recovery from chain data',()=>{
 const s=snapshot();expect(offerActionIntent(s,owner,0)).toMatchObject({action:1});expect(()=>offerActionIntent(s,other,0)).toThrow(/owned/);
 expect(()=>offerActionIntent(snapshot(1),owner,0)).toThrow(/active/);
 s.instance.state=advance(s.instance.state,1,0);expect(offerActionIntent(s,owner,0)).toMatchObject({action:4});
 s.offerHistory=[{action:1,slot:0,txid:'cancel',pending:true}];expect(()=>offerActionIntent(s,owner,0)).toThrow(/confirmation/);
 s.offerHistory=[];s.instance.state=advance(s.instance.state,4,0);expect(()=>offerActionIntent(s,owner,0)).toThrow(/active/);
});
it('rejects withdrawal before maturity, requires exact owner and allocation, and preserves pending withdrawals',()=>{
 const s=snapshot(1),id=s.allocations[0].id;expect(()=>offerActionIntent(s,owner,0,id)).toThrow(/mature/);expect(()=>offerActionIntent(s,other,0,id)).toThrow(/owned/);
 s.allocations[0].mature=true;expect(offerActionIntent(s,owner,0,id)).toMatchObject({operation:'withdraw',allocation:id});s.allocations[0].pending='pending';expect(()=>offerActionIntent(s,owner,0,id)).toThrow();
});
it('preserves legacy multi-win accounting and independently locked allocations',()=>{
 const s=snapshot(1,3);expect(ownedOffers(s,owner)[0]).toMatchObject({status:'ACTIVE',record:{wins:1,maxWins:3},allocations:[{mature:false}]});
 s.instance.state=advance(s.instance.state,1,0);expect(ownedOffers(s,owner)[0]).toMatchObject({status:'WON / LOCKED',recovery:true});
 s.instance.state=advance(s.instance.state,4,0);expect(ownedOffers(s,owner)[0]).toMatchObject({status:'WON / LOCKED',recovery:false});
 render(<MyOffers owner={owner} live={false} listings={{legacy:{snapshot:s,at:1}}} busy={false} operations={[]} act={vi.fn()}/>);expect(screen.getByText(/Unused commitment:/)).toHaveTextContent('Unused commitment: 0.00000000 BCH');
});
it.each(['mainnet','chipnet'] as const)('allows proven unsigned/rejected discard on %s offline, retaining journals and signed safeguards',async network=>{
 const provider=new MockNetworkProvider() as any;provider.network=network==='mainnet'?Network.MAINNET:Network.CHIPNET;
 let op={...base,network};const store={list:async()=>[op],save:async(o:Operation)=>{op=o as typeof op;}};const wallet=new AssetWallet(provider,store);
 for(const signing of ['unsigned','rejected'] as const){op={...base,network,signing};expect(blocksVault(op)).toBe(false);await wallet.discard(op.id);expect(op.step).toBe('complete');expect(op.error).toMatch(/journal retained/);}
 for(const patch of [{raw:'signed'},{txid:'broadcast'},{fundingRaw:'signed-parent'},{funding:'funded'},{childRaw:'child'},{signing:'requested' as const},{signing:undefined},{acceptedAt:1},{stage:'pending' as const},{stage:'prepared' as const}]){
  op={...base,network,...patch};expect(canDiscardUnsigned(op)).toBe(false);expect(blocksVault(op)).toBe(true);await expect(wallet.discard(op.id)).rejects.toThrow(/unsigned/);
 }
});
it('wallet transaction preparation rejects exhausted cancellation and immature/wrong owner withdrawals before funding',async()=>{
 const provider=new MockNetworkProvider() as any;provider.network=Network.REGTEST;const wallet=new AssetWallet(provider,{list:async()=>[],save:vi.fn()});
 const sync=vi.spyOn(AssetIndexer.prototype,'sync').mockResolvedValue(snapshot(1));
 await expect(wallet.action(config,1,0,[base.owner])).rejects.toThrow(/active/);
 await expect(wallet.withdraw(config,'win0:4',[base.owner])).rejects.toThrow(/immature/);
 const s=snapshot(1);s.allocations[0].mature=true;sync.mockResolvedValue(s);
 await expect(wallet.withdraw(config,'win0:4',[{...base.owner,publicKey:other}])).rejects.toThrow(/owned/);
});

it.each(['bch','token'] as const)('withdrawal covenant returns the full %s stake, requires the owner signature and external BCH fee',asset=>{
 const provider=new MockNetworkProvider() as any;provider.network=Network.REGTEST;const key=new SignatureTemplate(new Uint8Array(32).fill(91)),wrong=new SignatureTemplate(new Uint8Array(32).fill(92));
 const category=asset==='bch'?'00'.repeat(32):'ab'.repeat(32),terms=allocationTerms(key.publicKey,'cd'.repeat(32),category,0,0,3000,0x400002);
 const allocation=covenant('StakeAllocationV3',[terms],provider),input={txid:'11'.repeat(32),vout:4,satoshis:asset==='bch'?3000n:1000n,lockingBytecode:allocation.lockingBytecode,...(asset==='token'?{token:{category,amount:3000n}}:{})};
 const fee={txid:'22'.repeat(32),vout:0,satoshis:FEE,lockingBytecode:walletScript(Buffer.from(key.publicKey).toString('hex'))},sponsor={input:fee,unlocker:key.unlockP2PKH()};
 const built=withdrawalBuilder(input,terms,key,sponsor,provider),raw=built.build(),checked=validateBuilt(raw,[input,fee],{height:100,mtp:500002000},500000000);
 expect(checked.fee).toBe(FEE);expect(checked.transaction.outputs[0].valueSatoshis).toBe(input.satoshis);expect(checked.transaction.outputs[0].token?.amount??0n).toBe(asset==='token'?3000n:0n);
 expect(Buffer.from(checked.transaction.outputs[0].lockingBytecode).toString('hex')).toBe(walletScript(Buffer.from(key.publicKey).toString('hex')));
 expect(()=>validateBuilt(raw,[input,fee],{height:100,mtp:500000100},500000000)).toThrow(/mature/);
 expect(()=>withdrawalBuilder(input,terms,key,{...sponsor,input:{...fee,satoshis:FEE-1n}},provider)).toThrow(/fee/);
 const forged=withdrawalBuilder(input,terms,wrong,sponsor,provider).build();expect(()=>validateBuilt(forged,[input,fee],{height:100,mtp:500002000},500000000)).toThrow(/validation failed/);
});
