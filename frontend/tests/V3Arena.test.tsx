import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {WalletTransactionsContext} from '../src/walletTransactions';
import V3Arena from '../src/V3Arena';
import {v3Call} from '../src/v3Client';
import {Buffer} from '../../src/bytes';
import {initialState,advance,type Parameters} from '../../src/v3/model';
import {offer} from '../../src/registry';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn(async()=>[]),verifyMarketplace:vi.fn(async(config:unknown)=>v3Call({operation:'sync',config})),cancelMarketplaceReads:vi.fn()}));
const p:Parameters={version:3,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n},config={...p,genesis:'ab'.repeat(32)};
const wallet={publicKey:()=>'02'+'11'.repeat(32),execute:vi.fn(),v3:vi.fn()};
function stubCatalog(){vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[{config,announcement:config.genesis,height:1,status:'observed-confirmed'}],pages:[],total:1},(_,v)=>typeof v==='bigint'?String(v):v))));}
function stub(phase='ready'){const state=advance(initialState(p),0,0,offer(Buffer.from('02'+'11'.repeat(32),'hex'),3000,513,3000,2));vi.mocked(v3Call).mockImplementation(async intent=>{
 if(intent.operation==='connect')return {network:'mainnet',tips:[{height:100}]};
 if(intent.operation==='sync')return {snapshot:{config,instance:{parameters:p,state},clock:{mtp:p.epoch+7201},pending:[],allocations:[]},next:{phase,available:4000n,reason:'Top offer exceeds available buffer'},required:10000n,minerFee:10000n,carriers:0n};
 if(intent.operation==='claim')return {id:'cd'.repeat(32),status:'pending'};return [];
});}
async function open(connected=true){window.location.hash='/v3/offers';const view=render(<WalletTransactionsContext.Provider value={connected?wallet:null}><V3Arena/></WalletTransactionsContext.Provider>);fireEvent.click(screen.getByText('Import or share a vault configuration'));fireEvent.change(screen.getByLabelText('Public v3 configuration'),{target:{value:JSON.stringify(config,(_,v)=>typeof v==='bigint'?v.toString():v)}});await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify and refresh chain state'})));await waitFor(()=>expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeInTheDocument());return view;}
it('requires explicit caller wallet approval and labels broadcast as pending',async()=>{
 stub();wallet.v3.mockResolvedValue({kind:'claim',id:'claim',step:'action',stage:'pending'});await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeEnabled();expect(screen.getByRole('cell',{name:'513'})).toBeInTheDocument();expect(screen.getByText(/Priority uses the requested T/)).toBeInTheDocument();expect(screen.getByText(/Estimated queue position:/)).toHaveTextContent('Independent lock: 4096s');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(wallet.v3).toHaveBeenCalledWith({operation:'claim',config});expect(screen.getByRole('status')).toHaveTextContent('pending');expect(screen.getByRole('status')).not.toHaveTextContent('confirmed');
});
it('blocks claims when the covenant buffer is insufficient and preserves the top offer',async()=>{
 stub('blocked');await open();expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('Top offer exceeds available buffer');expect(screen.getByText('1539000 / 3000')).toBeInTheDocument();
});
it('requires a connected compatible wallet even when rewards are available',async()=>{stub('ready');await open(false);expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();expect(screen.getByText(/Claim unavailable:/)).toHaveTextContent('connect a compatible WizardConnect/Cashonize wallet');});

it('surfaces wallet rejection and keeps recovery operations visible',async()=>{stub();wallet.v3.mockRejectedValue(Error('Wallet rejected signing; unsigned claim retained'));await open();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review and pay fee in wallet'})));expect(screen.getByRole('status')).toHaveTextContent('Wallet rejected');expect(v3Call).toHaveBeenCalledWith({operation:'list'});});

it('shows a journaled vault row after reload before opening its detail',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;vi.mocked(v3Call).mockImplementation(async (...args)=>args[0].operation==='list'?[{id:'direct',kind:'create',creationMode:'direct',step:'action',stage:'pending',raw:'signed',txid:config.genesis,config,parameters:p}]:previous(...args));
 render(<WalletTransactionsContext.Provider value={wallet}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(screen.getByRole('link',{name:'Vault 1'})).toHaveAttribute('href','#/v3/vault/'+config.genesis));
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
 expect(vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync')).toHaveLength(0);expect(wallet.v3).toHaveBeenCalledWith(expect.objectContaining({operation:'offer',config}));
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
it('shows capacity exhaustion rejected by wallet preparation before approval',async()=>{
 stub();wallet.v3.mockReset();await open();const previous=vi.mocked(v3Call).getMockImplementation()!;
 wallet.v3.mockRejectedValue(Error('Vault offer capacity exhausted (sixteen lifetime registrations).'));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(wallet.v3).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('capacity exhausted');
});
it('keeps invalid offers blocked as the display ages',async()=>{
 stub();await open();fireEvent.change(screen.getByLabelText('Duration T (seconds)'),{target:{value:'0'}});await ageDisplay();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();expect(screen.getByText(/Make an Offer unavailable:/)).toBeInTheDocument();
});
it('retains the display when wallet preparation rejects unavailable providers',async()=>{
 stub();wallet.v3.mockReset();await open();const previous=vi.mocked(v3Call).getMockImplementation()!;
 wallet.v3.mockRejectedValue(Error('Provider unavailable'));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(wallet.v3).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('Provider unavailable');expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeInTheDocument();
});
it('opens a saved vault automatically without a manual verification click',async()=>{
 stub();window.location.hash='/v3/vault/'+config.genesis;localStorage.setItem('staking-arena-v3-configs-mainnet',JSON.stringify([config],(_,v)=>typeof v==='bigint'?v.toString():v));
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
 stub();window.location.hash='/v3/offers';stubCatalog();
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByRole('cell',{name:'1'})).toBeInTheDocument());
 const card=screen.getByRole('link',{name:'Vault 1'});expect(card).toHaveAttribute('href','#/v3/vault/'+config.genesis);expect(card.closest('tr')).toHaveTextContent('0.00002000 BCH');expect(card.closest('tr')).not.toHaveTextContent('Remaining reward reserve');
 expect(v3Call).toHaveBeenCalledWith({operation:'sync',config});
});
it('withholds shared financial figures if chain verification fails',async()=>{
 stub();window.location.hash='/v3/offers';stubCatalog();
 const previous=vi.mocked(v3Call).getMockImplementation()!;vi.mocked(v3Call).mockImplementation(async(...args)=>{if(args[0].operation==='sync')throw Error('Genesis mismatch');return previous(...args);});
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByText('Unavailable')).toHaveAttribute('title',expect.stringContaining('verification unavailable')));expect(screen.queryByText('Remaining reward reserve')).not.toBeInTheDocument();
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

it('shows one fee on atomic vaults and reports accepted broadcast without waiting for refresh',async()=>{
 stub();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await original(...args);if(args[0].operation==='sync'){result.snapshot.config={...config,registryVersion:4};result.snapshot.provisional=true;result.snapshot.instance.inputs=[{txid:'cd'.repeat(32)}];}return result;});
 wallet.v3.mockReset().mockResolvedValue({id:'atomic',kind:'offer',registrationMode:'atomic',step:'action',stage:'pending',raw:'signed',txid:'cd'.repeat(32)});
 await open();expect(screen.getByText(/Atomic registration: one transaction/)).toHaveTextContent('one 10,000-satoshi miner fee');
 const before=vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync').length;
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='sync').length).toBe(before);
 expect(screen.getByText(/Pending \(0-conf\) — awaiting on-chain verification/)).toHaveTextContent('cd'.repeat(32));
 expect(screen.getByRole('cell',{name:/Pending \(0-conf\) · provisional/})).toBeInTheDocument();
});

it('discovers a public vault in a fresh browser without a connected wallet or local configurations',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;
 stubCatalog();
 expect(localStorage.length).toBe(0);render(<WalletTransactionsContext.Provider value={null}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(screen.getByRole('link',{name:'Vault 1'}).closest('tr')).toHaveTextContent('0.00002000 BCH'));
 expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='discover')).toBe(false);
});
it('retains configuration through failure and reload while retaining provisional immutable hints and withholding stale counts',async()=>{
 stub();window.location.hash='/v3/offers';const previous=vi.mocked(v3Call).getMockImplementation()!;
 stubCatalog();
 const first=render(<V3Arena/>);await waitFor(()=>expect(screen.getByRole('link',{name:'Vault 1'}).closest('tr')).toHaveTextContent('0.00002000 BCH'));await waitFor(()=>expect(JSON.parse(localStorage.getItem('staking-arena-v3-configs-mainnet-snapshots')??'{}')[config.genesis]?.snapshot).toBeDefined());first.unmount();
 vi.mocked(v3Call).mockImplementation(async intent=>{if(intent.operation==='sync'||intent.operation==='discover')throw Error('Public provider offline');return [];});
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByText('Unavailable')).toBeInTheDocument());
 expect(screen.getByRole('link',{name:'Vault 1'}).closest('tr')).toHaveTextContent('0.00002000 BCH · provisionalBCHUnavailable');
 expect(JSON.parse(localStorage.getItem('arena-public-index-v1-mainnet')!)[0].config.genesis).toBe(config.genesis);
});

it('limits verification to two displayed candidates while rendering a twenty-entry page immediately',async()=>{
 stub();window.location.hash='/v3/offers';const rows=Array.from({length:20},(_,i)=>({config:{...config,genesis:(i+1).toString(16).padStart(64,'0')},announcement:(i+1).toString(16).padStart(64,'0'),height:0,status:'provisional'}));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:rows,pages:[],total:1000},(_,v)=>typeof v==='bigint'?String(v):v))));
 const original=vi.mocked(v3Call).getMockImplementation()!;let active=0;const release:Array<()=>void>=[];
 vi.mocked(v3Call).mockImplementation(async(...args)=>{if(args[0].operation==='sync'){active++;await new Promise<void>(resolve=>release.push(resolve));active--;throw Error('Offline');}return original(...args);});
 const view=render(<V3Arena/>);await waitFor(()=>expect(document.querySelectorAll('.marketplace-table tbody tr')).toHaveLength(20));await waitFor(()=>expect(active).toBe(2));expect(vi.mocked(v3Call).mock.calls.filter(([i])=>i.operation==='discover')).toHaveLength(0);view.unmount();await act(async()=>release.forEach(resolve=>resolve()));
});

it('shows a submitted offer before slow refresh and automatically promotes it after failed and delayed provider reads, without a wallet',async()=>{
 stub();const previous=vi.mocked(v3Call).getMockImplementation()!;
 const txid='47'.repeat(32),source='c5'.repeat(32);
 let journal:any[]=[],attempt=0,accepted=false;
 const pendingOp={id:'submitted',version:3,kind:'offer',registrationMode:'atomic',step:'action',stage:'pending',raw:'signed',txid,source,config,parameters:p,owner:{publicKey:wallet.publicKey(),path:'receive',index:0},terms:{stake:3000n,duration:3600,reward:1000n,maxWins:1},acceptedAt:Date.now()};
 vi.mocked(v3Call).mockImplementation(async(...args)=>{
  const intent=args[0];if(intent.operation==='list')return journal;
  if(intent.operation==='inspectRead')return {original:journal[0],result:{...journal[0],observation:attempt>=2?'pending':'propagating'}};
  if(intent.operation==='applyInspection'){journal=[intent.result];return intent.result;}
  const result=await previous(...args);
  if(intent.operation==='sync'){
   if(accepted&&++attempt===1)throw Error('Provider propagation delayed');
   result.snapshot.instance.inputs=[{txid:attempt>=3?txid:source}];result.snapshot.history=[];result.snapshot.pendingHistory=attempt>=3?[txid]:[];
   result.snapshot.instance.state=attempt>=3?advance(initialState(p),0,0,offer(Buffer.from(wallet.publicKey(),'hex'),3000,3600,1000,1)):initialState(p);
   if(journal.length)result.inspections=[{original:journal[0],result:{...journal[0],observation:attempt>=3?'pending':'propagating',stage:attempt>=3?'pending':'prepared'}}];
  }return result;
 });
 wallet.v3.mockImplementation(async()=>{accepted=true;journal=[pendingOp];return pendingOp;});const view=await open();
 const start=performance.now();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Make an Offer'})));
 expect(screen.getByRole('region',{name:'Locally submitted offers'})).toHaveTextContent('Unranked');const visibleMs=performance.now()-start;expect(visibleMs).toBeLessThan(500);console.log('ACCEPTED_TO_PROVISIONAL_RENDER_MS',visibleMs);
 expect(screen.getByText(/Make an Offer unavailable:/)).not.toHaveTextContent('discard');
 view.rerender(<WalletTransactionsContext.Provider value={null}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(attempt).toBeGreaterThanOrEqual(1),{timeout:2500});expect(screen.getByRole('region',{name:'Locally submitted offers'})).toBeVisible();
 await waitFor(()=>expect(screen.queryByRole('region',{name:'Locally submitted offers'})).toBeNull(),{timeout:10000});
 expect(screen.getByRole('cell',{name:'Active · #0'})).toBeVisible();expect(screen.getByText(/Current state transaction:/)).toHaveTextContent(txid);expect(journal[0].observation).toBe('pending');expect(screen.getByText(/Offer independently verified — Pending/)).toHaveTextContent('Live queue updated');
 expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='rebroadcast')).toBe(false);
},15000);

it('shows only four marketplace columns, offers first, and places refresh directly after the heading',async()=>{
 stub();stubCatalog();window.location.hash='/v3/offers';render(<V3Arena/>);
 await waitFor(()=>expect(screen.getByText('0.00002000 BCH')).toBeVisible());
 expect(screen.getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Vault','Max reward / period','Staking asset','Offers']);
 expect(screen.getByRole('navigation',{name:'V3 actions'}).firstElementChild).toHaveTextContent('Make an Offer');
 expect(screen.getByRole('heading',{name:'Known vaults'}).nextElementSibling).toBe(screen.getByRole('button',{name:'Refresh public discovery'}));
 expect(screen.queryByText(/Public staking marketplace:/)).toBeNull();
});
it('continues display numbering on the second page and preserves genesis links',async()=>{
 stub();window.location.hash='/v3/offers';const configs=Array.from({length:21},(_,i)=>({...config,genesis:(i+1).toString(16).padStart(64,'0')}));
 localStorage.setItem('staking-arena-v3-configs-mainnet',JSON.stringify(configs,(_,v)=>typeof v==='bigint'?String(v):v));render(<V3Arena/>);
 expect(screen.getByRole('link',{name:'Vault 20'})).toHaveAttribute('href','#/v3/vault/'+configs[19]!.genesis);
 fireEvent.click(screen.getByRole('button',{name:'Next vaults'}));expect(screen.getByRole('link',{name:'Vault 21'})).toHaveAttribute('href','#/v3/vault/'+configs[20]!.genesis);
 expect(screen.queryByRole('link',{name:'Vault 1'})).toBeNull();
});
it('withholds counts while replay is pending, then counts only active verified offers and labels provisional state',async()=>{
 stub();stubCatalog();window.location.hash='/v3/offers';const original=vi.mocked(v3Call).getMockImplementation()!;let resolve!:()=>void;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await original(...args);if(args[0].operation==='sync'){
  await new Promise<void>(r=>{resolve=r;});
  let state=initialState(p);for(let i=0;i<4;i++)state=advance(state,0,i,offer(Buffer.from(wallet.publicKey(),'hex'),3000,513,3000,1));
  state=advance(state,1,1);state=advance(state,3,0);state=advance(state,1,3);state=advance(state,4,3);
  result.snapshot.instance.state=state;result.snapshot.provisional=true;
 }return result;});render(<V3Arena/>);
 await waitFor(()=>expect(resolve).toBeDefined());expect(screen.getAllByRole('row')[1]!.lastElementChild).toHaveTextContent('Verifying…');expect(screen.queryByRole('cell',{name:'0'})).toBeNull();
 await act(async()=>resolve());await waitFor(()=>expect(screen.getAllByRole('row')[1]!.lastElementChild).toHaveTextContent('1'));expect(screen.getAllByRole('row')[1]!.lastElementChild).toHaveTextContent('0-conf · provisional');
});
it('renders verified token assets and immutable cap with a verified empty queue',async()=>{
 stub();window.location.hash='/v3/offers';
 const tokenConfig:typeof config={...config,stakingAsset:{kind:'token',category:'12'.repeat(32)},rewardAsset:{kind:'token',category:'34'.repeat(32)},cap:1000n};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[{config:tokenConfig,announcement:config.genesis,height:1,status:'observed-confirmed'}],pages:[]},(_,v)=>typeof v==='bigint'?String(v):v))));
 const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await previous(...args);if(args[0].operation==='sync'){result.snapshot.config=tokenConfig;result.snapshot.instance.state=initialState(tokenConfig);}return result;});
 render(<V3Arena/>);await waitFor(()=>expect(screen.getByText('1000 CashToken 34343434…34343434')).toBeVisible());
 expect(screen.getByText('CashToken 12121212…12121212')).toBeVisible();await waitFor(()=>expect(screen.getAllByRole('row')[1]!.lastElementChild).toHaveTextContent(/^0$/));
 expect(screen.queryByText('4000 CashToken 34343434…34343434')).toBeNull();
});

it('renders index parameter hints while all Electrum reads are pending, with no fabricated offer count',async()=>{
 stub();stubCatalog();window.location.hash='/v3/offers';
 const previous=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation((...args)=>args[0].operation==='sync'?new Promise(()=>{}):previous(...args));
 render(<V3Arena/>);
 await waitFor(()=>expect(screen.getByRole('link',{name:'Vault 1'}).closest('tr')).toHaveTextContent('0.00002000 BCH'));
 const row=screen.getByRole('link',{name:'Vault 1'}).closest('tr')!;
 expect(row).toHaveTextContent('provisional');expect(row.lastElementChild).toHaveTextContent('Verifying…');
 expect(wallet.v3).not.toHaveBeenCalled();
});

it('displays single-provider state before independent verification and blocks every financial control after conflict',async()=>{
 stub();stubCatalog();window.location.hash='/v3/vault/'+config.genesis;
 const previous=vi.mocked(v3Call).getMockImplementation()!;
 const candidate=await previous({operation:'sync',config});
 let fail!:(error:Error)=>void;
 vi.mocked(v3Call).mockImplementation((...args)=>args[0].operation==='sync'?new Promise((_resolve,reject)=>{fail=reject;}):previous(...args));
 render(<WalletTransactionsContext.Provider value={wallet}><V3Arena/></WalletTransactionsContext.Provider>);
 await waitFor(()=>expect(fail).toBeDefined());
 act(()=>window.dispatchEvent(new CustomEvent('arena-vault-display',{detail:candidate})));
 expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeVisible();
 expect(screen.getByText(/Single-provider \/ retained display only/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Review and pay fee in wallet'})).toBeDisabled();
 await act(async()=>fail(Error('Conflicting blockchain evidence — transaction blocked.')));
 expect(screen.getByText(/Providers disagree/)).toBeVisible();
 expect(screen.getByRole('heading',{name:'Live ranked queue'})).toBeVisible();
 expect(wallet.v3).not.toHaveBeenCalled();
});
