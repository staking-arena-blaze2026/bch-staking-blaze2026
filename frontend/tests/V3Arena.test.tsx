import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {WalletTransactionsContext} from '../src/walletTransactions';
import V3Arena from '../src/V3Arena';
import {v3Call} from '../src/v3Client';
import {Buffer} from '../../src/bytes';
import {initialState,advance,type Parameters} from '../../src/v3/model';
import {offer} from '../../src/registry';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn(async()=>[])}));
const p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n},config={...p,genesis:'ab'.repeat(32)};
const wallet={publicKey:()=>'02'+'11'.repeat(32),execute:vi.fn(),v3:vi.fn()};
function stub(phase='ready'){const state=advance(initialState(p),0,0,offer(Buffer.from('02'+'11'.repeat(32),'hex'),3000,513,3000,2));vi.mocked(v3Call).mockImplementation(async intent=>{
 if(intent.operation==='sync')return {snapshot:{config,instance:{parameters:p,state},clock:{mtp:p.epoch+7201},pending:[],allocations:[]},next:{phase,available:4000n,reason:'Top offer exceeds available buffer'},required:10000n,minerFee:10000n,carriers:0n};
 if(intent.operation==='claim')return {id:'cd'.repeat(32),status:'pending'};return [];
});}
async function open(connected=true){window.location.hash='/v3/offers';render(<WalletTransactionsContext.Provider value={connected?wallet:null}><V3Arena/></WalletTransactionsContext.Provider>);fireEvent.change(screen.getByLabelText('Public v3 configuration'),{target:{value:JSON.stringify(config,(_,v)=>typeof v==='bigint'?v.toString():v)}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify and refresh chain state'})));await waitFor(()=>expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeInTheDocument());}
it('requires explicit caller wallet approval and labels broadcast as pending',async()=>{
 stub();wallet.v3.mockResolvedValue({kind:'claim',id:'claim',step:'action',stage:'pending'});await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();expect(screen.getByRole('cell',{name:'513'})).toBeInTheDocument();expect(screen.getByText(/Priority uses the requested T/)).toBeInTheDocument();expect(screen.getByText(/Estimated queue position:/)).toHaveTextContent('Independent lock: 4096s');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(wallet.v3).toHaveBeenCalledWith({operation:'claim',config});expect(screen.getByRole('status')).toHaveTextContent('pending');expect(screen.getByRole('status')).not.toHaveTextContent('confirmed');
});
it('blocks claims when the covenant buffer is insufficient and preserves the top offer',async()=>{
 stub('blocked');await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('Top offer exceeds available buffer');expect(screen.getByText('1539000 / 3000')).toBeInTheDocument();
});
it('requires a connected compatible wallet even when rewards are available',async()=>{stub('ready');await open(false);expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('connect a compatible WizardConnect/Cashonize wallet');});

it('surfaces wallet rejection and keeps recovery operations visible',async()=>{stub();wallet.v3.mockRejectedValue(Error('Wallet rejected signing; unsigned claim retained'));await open();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(screen.getByRole('status')).toHaveTextContent('Wallet rejected');expect(v3Call).toHaveBeenCalledWith({operation:'list'});});

it('shows a journaled pending vault card after reload before opening its detail',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;vi.mocked(v3Call).mockImplementation(async (...args)=>args[0].operation==='list'?[{id:'direct',kind:'create',creationMode:'direct',step:'action',stage:'pending',raw:'signed',txid:config.genesis,config,parameters:p}]:previous(...args));
 render(<WalletTransactionsContext.Provider value={wallet}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(screen.getByText(/Genesis transaction:/)).toHaveTextContent('Pending (0-conf)'));
 expect(screen.getByText(/Genesis transaction:/)).toHaveTextContent(config.genesis);
 expect(screen.queryByRole('button',{name:'Review and pay fee in wallet'})).not.toBeInTheDocument();
 expect(screen.getByText(/Vault creation and claims use one wallet approval/)).toBeInTheDocument();
});

async function ageDisplay(){vi.spyOn(Date,'now').mockReturnValue(Date.now()+31000);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1050));});}
it('keeps eligible actions and the ranked display available after thirty seconds and verifies on offer click',async()=>{
 stub();wallet.v3.mockReset().mockResolvedValue({stage:'pending'});await open();vi.mocked(v3Call).mockClear();
 await ageDisplay();expect(screen.getByText(/Displayed state may be outdated/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();
 expect(vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync')).toHaveLength(0);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(v3Call).toHaveBeenCalledWith({operation:'sync',config});expect(wallet.v3).toHaveBeenCalledWith(expect.objectContaining({operation:'offer',config}));
 const syncIndex=vi.mocked(v3Call).mock.calls.findIndex(([i])=>i.operation==='sync');
 expect(vi.mocked(v3Call).mock.invocationCallOrder[syncIndex]).toBeLessThan(wallet.v3.mock.invocationCallOrder[0]!);
 expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeInTheDocument();
});
it('recalculates claim eligibility after refreshing an aged display',async()=>{
 stub();wallet.v3.mockReset();await open();await ageDisplay();stub('blocked');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));
 expect(wallet.v3).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Top offer exceeds available buffer');
 expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();
});
it('allows an aged insufficient-buffer display to be rechecked for a newly released reward',async()=>{
 stub('blocked');wallet.v3.mockReset().mockResolvedValue({stage:'pending'});await open();await ageDisplay();stub();
 expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));
 expect(wallet.v3).toHaveBeenCalledWith({operation:'claim',config});
});
it('shows fresh capacity exhaustion without entering the wallet',async()=>{
 stub();wallet.v3.mockReset();await open();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync')result.snapshot.instance.state[5]=16;return result;});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(wallet.v3).not.toHaveBeenCalled();expect(screen.getByText(/Make an Offer unavailable:/)).toHaveTextContent('capacity exhausted');
});
it('keeps invalid offers blocked as the display ages',async()=>{
 stub();await open();fireEvent.change(screen.getByLabelText('Duration T (seconds)'),{target:{value:'0'}});await ageDisplay();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();expect(screen.getByText(/Make an Offer unavailable:/)).toBeInTheDocument();
});
it('retains the display after provider failure and never enters the wallet on unverified state',async()=>{
 stub();wallet.v3.mockReset();await open();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{if(args[0].operation==='sync')throw Error('Provider unavailable');return previous(...args);});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(wallet.v3).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Provider unavailable');expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeInTheDocument();
});
it('opens a saved vault automatically without a manual verification click',async()=>{
 stub();window.location.hash='/v3/vault/'+config.genesis;localStorage.setItem('staking-arena-v3-configs-chipnet',JSON.stringify([config],(_,v)=>typeof v==='bigint'?v.toString():v));
 render(<WalletTransactionsContext.Provider value={wallet}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Make an Offer'})).toBeEnabled());
 expect(v3Call).toHaveBeenCalledWith({operation:'sync',config});
});

it('rejects a changed claim state and shows the refreshed queue before any wallet approval',async()=>{
 stub();wallet.v3.mockReset();await open();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync')result.snapshot.instance.state=advance(result.snapshot.instance.state,3,0);return result;});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));
 expect(wallet.v3).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Vault state changed');expect(screen.getByRole('cell',{name:'Active · #0 · Legacy offer: 1 reward payment remaining'})).toBeInTheDocument();
});

it('keeps owner cancellation, unused commitment recovery and matured withdrawal available after thirty seconds',async()=>{
 stub();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync'){
  result.snapshot.instance.state=advance(advance(result.snapshot.instance.state,0,1,offer(Buffer.from(wallet.publicKey(),'hex'),3000,513,3000,2)),1,1);
  const terms=Buffer.alloc(78);Buffer.from(wallet.publicKey(),'hex').copy(terms);terms.writeUInt32LE(3000,70);terms.writeUInt32LE(2,74);
  result.snapshot.allocations=[{id:'allocation:4',terms,sourceMtp:p.epoch,mature:true}];
 }return result;});
 await open();await ageDisplay();expect(screen.getAllByRole('button',{name:'Cancel'})[0]).toBeEnabled();
 expect(screen.getAllByRole('button',{name:'Recover unused commitment'})[1]).toBeEnabled();
 expect(screen.getByRole('button',{name:'Withdraw in owner wallet'})).toBeEnabled();
});

it('allows an aged empty queue to be checked for newly eligible offers',async()=>{
 stub('blocked');const previous=vi.mocked(v3Call).getMockImplementation()!;wallet.v3.mockReset().mockResolvedValue({stage:'pending'});
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync'){result.snapshot.instance.state=initialState(p);result.next.reason='No active offers';}return result;});
 await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();await ageDisplay();
 expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();stub();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));
 expect(wallet.v3).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Vault state changed');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));
 expect(wallet.v3).toHaveBeenCalledWith({operation:'claim',config});
});

it('offers only S, T and R, shows commitment S, and submits one win',async()=>{
 stub();wallet.v3.mockReset().mockResolvedValue({stage:'pending'});await open();
 expect(screen.queryByLabelText(/Maximum wins/)).not.toBeInTheDocument();expect(screen.getByRole('group',{name:'New v3 offer'}).querySelectorAll('input')).toHaveLength(3);
 expect(screen.getByLabelText('Stake S (BCH)')).toBeInTheDocument();expect(screen.getByLabelText('Duration T (seconds)')).toBeInTheDocument();expect(screen.getByLabelText('Requested reward R (BCH)')).toBeInTheDocument();
 expect(screen.getByText(/Required staking commitment:/)).toHaveTextContent('Required staking commitment: 0.00003000 BCH (3000 satoshis)');
 expect(screen.getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Rank','Stake S','Duration T (seconds)','Requested reward R','Priority P = S × T / R','Offer status']);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(wallet.v3).toHaveBeenCalledWith({operation:'offer',config,terms:{stake:3000n,duration:3600,reward:1000n,maxWins:1}});
});
it('shows a one-win offer as completed outside the active queue after its reward is paid',async()=>{
 stub();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync')result.snapshot.instance.state=advance(advance(initialState(p),0,0,offer(Buffer.from(wallet.publicKey(),'hex'),3000,513,3000,1)),3,0);return result;});
 await open();expect(screen.getByText('Offer #0: completed')).toBeInTheDocument();expect(screen.getAllByRole('row')).toHaveLength(1);expect(screen.getByText('No active offers. Make the first offer; released rewards continue accumulating.')).toBeInTheDocument();
});

it('switches tabs without losing creation inputs and follows browser history hashes',async()=>{
 stub();window.location.hash='/v3';render(<V3Arena/>);
 fireEvent.change(screen.getByLabelText('Interval (seconds)'),{target:{value:'7200'}});
 await act(async()=>{window.location.hash='/v3/offers';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByRole('heading',{name:'Known vaults'})).toBeVisible();expect(screen.getByRole('link',{name:'Make an Offer'})).toHaveAttribute('aria-current','page');
 await act(async()=>{window.location.hash='/v3';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByLabelText('Interval (seconds)')).toHaveValue('7200');expect(screen.getByRole('link',{name:'Create a Vault'})).toHaveAttribute('aria-current','page');
});
it('verifies shared configurations before showing figures and links to their dedicated page',async()=>{
 stub();window.location.hash='/v3/offers';vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({network:'chipnet',vaults:[{...config,cap:'2000'}]})}));
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByText('Active offers')).toBeInTheDocument());
 const card=screen.getByRole('link',{name:/V3 vault/});expect(card).toHaveAttribute('href','#/v3/vault/'+config.genesis);expect(card).toHaveTextContent('Confirmed · chain verified');expect(card).toHaveTextContent('Remaining reward reserve');
 expect(v3Call).toHaveBeenCalledWith({operation:'sync',config});
});
it('withholds shared financial figures if chain verification fails',async()=>{
 stub();window.location.hash='/v3/offers';vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({network:'chipnet',vaults:[{...config,cap:'2000'}]})}));
 const previous=vi.mocked(v3Call).getMockImplementation()!;vi.mocked(v3Call).mockImplementation(async(...args)=>{if(args[0].operation==='sync')throw Error('Genesis mismatch');return previous(...args);});
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByText(/Financial state unavailable/)).toHaveTextContent('Genesis mismatch'));expect(screen.queryByText('Remaining reward reserve')).not.toBeInTheDocument();
});
it('ranks exact priority ties by registration and estimates a new tie after existing offers with zero buffer',async()=>{
 stub();const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync'){
  let state=initialState(p);for(const [slot,stake,duration,reward] of [[0,3000,3600,1000],[1,6000,3600,2000],[2,6000,7200,1000]])state=advance(state,0,slot!,offer(Buffer.from(wallet.publicKey(),'hex'),stake!,duration!,reward!,1));
  result.snapshot.instance.state=state;result.next.available=0n;result.next.phase='blocked';
 }return result;});
 await open();const rows=screen.getAllByRole('row').slice(1);expect(rows.map(row=>row.lastElementChild?.textContent)).toEqual(['Active · #2','Active · #0','Active · #1']);
 expect(screen.getByText(/Estimated queue position:/)).toHaveTextContent('Estimated queue position: 4');expect(screen.getByRole('button',{name:'Make an Offer'})).toBeEnabled();
});

it('shows creation progress immediately and reports rejection beneath Create Vault',async()=>{
 stub();window.location.hash='/v3';let reject!:(error:Error)=>void;wallet.v3.mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 render(<WalletTransactionsContext.Provider value={wallet}><V3Arena/></WalletTransactionsContext.Provider>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:/^Create Vault$/})));
 expect(screen.getByRole('status')).toHaveTextContent('Preparing vault');
 act(()=>window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Checking unconfirmed ancestry…'})));
 expect(screen.getByRole('status')).toHaveTextContent('Checking unconfirmed ancestry');
 await act(async()=>reject(Error('Insufficient BCH for covenant-controlled preparation.')));
 expect(screen.getByRole('status')).toHaveTextContent('Insufficient BCH');expect(screen.getByRole('button',{name:/^Create Vault$/})).toBeEnabled();
});

it('shows one fee on atomic vaults and refreshes the provisional queue after registration',async()=>{
 stub();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await original(...args);if(args[0].operation==='sync'){result.snapshot.config={...config,registryVersion:4};result.snapshot.provisional=true;result.snapshot.instance.inputs=[{txid:'cd'.repeat(32)}];}return result;});
 wallet.v3.mockReset().mockResolvedValue({id:'atomic',kind:'offer',registrationMode:'atomic',step:'action',stage:'pending',txid:'cd'.repeat(32)});
 await open();expect(screen.getByText(/Atomic registration: one transaction/)).toHaveTextContent('one 10,000-satoshi miner fee');
 const before=vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync').length;
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync').length).toBe(before+2);
 expect(screen.getByText(/Offer registered — Pending/)).toHaveTextContent('cd'.repeat(32));
 expect(screen.getByRole('cell',{name:/Pending \(0-conf\) · provisional/})).toBeInTheDocument();
});

it('discovers a public vault in a fresh browser without a connected wallet or local configurations',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>args[0].operation==='discover'?{vaults:[config],observed:1,online:2,rejected:0}:previous(...args));
 expect(localStorage.length).toBe(0);render(<WalletTransactionsContext.Provider value={null}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(screen.getByRole('link',{name:/V3 vault/})).toHaveTextContent('Confirmed · chain verified'));
 expect(v3Call).toHaveBeenCalledWith({operation:'discover',cursor:undefined,limit:20});
});
it('retains configuration and stale verified figures through failure, reload and deployment without wallet access',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>args[0].operation==='discover'?{vaults:[config],observed:1,online:2,rejected:0}:previous(...args));
 const first=render(<V3Arena/>);await waitFor(()=>expect(screen.getByRole('link',{name:/V3 vault/})).toHaveTextContent('Confirmed · chain verified'));await waitFor(()=>expect(JSON.parse(localStorage.getItem('staking-arena-v3-configs-chipnet-snapshots')??'{}')[config.genesis]?.snapshot).toBeDefined());first.unmount();
 vi.mocked(v3Call).mockImplementation(async intent=>{if(intent.operation==='sync'||intent.operation==='discover')throw Error('Public provider offline');return [];});
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByRole('link',{name:/V3 vault/})).toHaveTextContent('Verification temporarily unavailable'));
 expect(screen.getByRole('link',{name:/V3 vault/})).toHaveTextContent('Stale, non-authoritative snapshot');
 expect(screen.getByRole('link',{name:/V3 vault/})).toHaveTextContent('Remaining reward reserve');
 expect(JSON.parse(localStorage.getItem('staking-arena-v3-configs-chipnet')!)[0].genesis).toBe(config.genesis);
});
