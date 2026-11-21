import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey} from '@bitauth/libauth';
import {render,screen,waitFor,fireEvent,cleanup,act,within} from '@testing-library/react';
vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet'}));
vi.mock('../src/queueClient',()=>({queueCall:vi.fn()}));
vi.mock('../src/queueCatalog',async importOriginal=>({...await importOriginal<typeof import('../src/queueCatalog')>(),loadQueuePage:vi.fn()}));
import {queueCall} from '../src/queueClient';
import {loadQueuePage} from '../src/queueCatalog';
import type {CatalogObservation} from '../../src/queue/catalog';
import QueueArena from '../src/QueueArena';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
const zero='00'.repeat(32),owner='02'+'11'.repeat(32),genesis='aa'.repeat(32);
const config={parameters:{stakingCategory:zero,rewardCategory:zero,epoch:1800000000,interval:60,releases:10,cap:2000n},identity:{vault:'bb'.repeat(32),queue:'cc'.repeat(32)},anchor:{genesis,creator:owner}};
const offer={id:'dd'.repeat(32),owner,stake:3000n,duration:512,reward:2000n,next:{id:zero,stake:0n,duration:0,reward:0n}};
const snapshot={config,tip:{height:200,hash:'ee'.repeat(32)},mtp:1800001200,state:{head:offer,reserve:20000n},ordered:[offer],nodes:new Map(),vault:{},root:{}};
let live=true,rows:any[]=[],failure=false;
const wallet:WalletTransactions={publicKey:()=>owner,pairing:()=>({paired:true,live,identity:owner,network:'chipnet'}),restore:vi.fn(),v3:vi.fn(),queue:vi.fn(async()=>({intent:{kind:'insert'},stage:'pending',step:'action',raw:'retained',txid:'ff'.repeat(32)})),execute:vi.fn()};
beforeEach(()=>{vi.spyOn(document,'hidden','get').mockReturnValue(false);localStorage.clear();sessionStorage.clear();rows=[];live=true;failure=false;vi.clearAllMocks();window.location.hash='#/v3/vault/'+genesis;vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[config],pages:[]});vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='list')return [];if(i.operation==='owned')return rows;if(failure)throw Error('Provider unavailable');return snapshot;});});
beforeEach(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
async function open(){render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);await screen.findByText('Remaining reserve',{}, {timeout:5000});}
it('validates 512-second units and preserves exact terms in the approval request',async()=>{await open();fireEvent.change(screen.getByLabelText('Lock duration (time units)'),{target:{value:'12'}});expect(screen.getAllByText(/1 hour, 42 minutes, 24 seconds/).length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'insert',config,terms:{stake:3000n,duration:6144,reward:2000n}}},expect.any(Function)));fireEvent.change(screen.getByLabelText('Lock duration (time units)'),{target:{value:'0'}});expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();});
it('binds a claim to the reviewed head, and waits for an offline saved pairing',async()=>{live=false;await open();const details=screen.getByRole('region',{name:'Vault details'});const button=screen.getByRole('button',{name:'Claim reward'});expect(details).toContainElement(button);expect(screen.getByText('Winning reward: 0.00002000 BCH')).toBeVisible();expect(screen.queryByRole('heading',{name:'Claim'})).toBeNull();expect(screen.getByRole('heading',{name:'Queue'})).toBeVisible();expect(button).toBeEnabled();fireEvent.click(button);expect(wallet.queue).not.toHaveBeenCalled();await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());live=true;await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'claim',config,expectedHead:offer.id}},expect.any(Function)));});
it('cancels deferred approval when the terms or route change',async()=>{live=false;await open();fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00004000'}});live=true;await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('request changed'));expect(wallet.queue).not.toHaveBeenCalled();});
it('shows owner states and enables matured withdrawal on the My Offers route',async()=>{window.location.hash='#/v3/my-offers';rows=[{id:offer.id,offer,status:'Baked',maturesAt:1800001000,checkedMtp:1800001200,eligible:true}];vi.mocked(queueCall).mockImplementation(async request=>request.operation==='list'?[]:request.operation==='owned'?rows:{...snapshot,ordered:[]});render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);const button=await screen.findByRole('button',{name:'Get my stake back'});expect(screen.getByText('Matured',{selector:'strong'})).toBeVisible();expect(screen.getByRole('button',{name:'Matured'})).toBeVisible();expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'withdraw',config,offerId:offer.id}},expect.any(Function)));});
it('displays local/MTP release timing and the complete expandable schedule',async()=>{await open();expect(screen.getByText(/Reported blockchain time \(MTP\):/)).toBeInTheDocument();const summary=screen.getByText('Release schedule and history');await act(async()=>{fireEvent.click(summary);summary.closest('details')!.open=true;fireEvent(summary.closest('details')!,new Event('toggle'));});expect(screen.getByRole('columnheader',{name:'Scheduled local time'})).toBeInTheDocument();expect(screen.getAllByRole('row').length).toBeGreaterThan(10);});

it('shows atomic counts, exact reviewed fee/debit, and clears stale estimates',async()=>{await open();expect(screen.getByText('Transactions: 1 · Wallet approvals: 1')).toBeVisible();expect(screen.queryByText(/Total stake committed:/)).toBeNull();expect(screen.getByText('1 time unit = 512 second')).toBeVisible();await act(async()=>{window.dispatchEvent(new CustomEvent('arena-queue-review',{detail:{intent:{kind:'insert'},plan:{fee:'3613'},walletDebit:'7813'}}));});expect(screen.getByText('Estimated network fee: 3613 sats')).toBeVisible();expect(screen.getByText(/Total wallet BCH committed, including fee: 7813 sats/)).toBeVisible();fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00004000'}});expect(screen.queryByText('Estimated network fee: 3613 sats')).not.toBeInTheDocument();});
it('calculates transaction and approval counts before approval on Create Vault',async()=>{window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);expect(await screen.findByText('Transactions: calculated before approval · Wallet approvals: calculated before approval')).toBeVisible();expect(screen.getByText('Total reward reserve')).toBeVisible();expect(screen.queryByText(/prepares the genesis/)).not.toBeInTheDocument();});
it('cancels the preparation confirmation when creation terms change',async()=>{
 HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');});window.location.hash='#/create';
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const respond=vi.fn();await act(async()=>{window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{respond,quote:{transactions:2,approvals:2,preparationFees:['219'],creationFee:'400',totalFee:'619',walletDebit:'50000',reserve:'40000',rewardCategory:zero}}}));});
 expect(respond).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Reward per release (min. 0.00001200 BCH)'),{target:{value:'0.00003000'}});await waitFor(()=>expect(respond).toHaveBeenCalledWith(false));
});

it('permanently labels the minimum, rejects 1199 sats and accepts exactly 1200',async()=>{
 window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const field=screen.getByLabelText('Reward per release (min. 0.00001200 BCH)');
 fireEvent.change(field,{target:{value:'0.00001199'}});
 expect(screen.getByRole('alert',{name:'cap error'})).toHaveTextContent('1,200 satoshis');expect(screen.getByRole('button',{name:'Create Vault'})).toBeDisabled();
 fireEvent.change(field,{target:{value:'0.00001200'}});expect(screen.queryByRole('alert',{name:'cap error'})).toBeNull();expect(screen.getByRole('button',{name:'Create Vault'})).toBeEnabled();
 expect(screen.getByLabelText('Reward per release (min. 0.00001200 BCH)')).toHaveValue('0.00001200');
});
it('blocks token entry when precision cannot be resolved',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404})));
 window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.change(screen.getByLabelText('Reward asset'),{target:{value:'token'}});fireEvent.change(screen.getByLabelText('Reward token category'),{target:{value:'ab'.repeat(32)}});
 fireEvent.change(screen.getByLabelText('Reward per release'),{target:{value:'1'}});
 expect(screen.getByRole('alert',{name:'cap error'})).toHaveTextContent('Token precision unavailable from BCMR');
 expect(screen.getByRole('button',{name:'Create Vault'})).toBeDisabled();
});
it('defaults CashToken rewards to one and keeps reward amounts per asset type',()=>{
 window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const asset=screen.getByLabelText('Reward asset');
 const bchReward=()=>screen.getByLabelText('Reward per release (min. 0.00001200 BCH)');
 const tokenReward=()=>screen.getByLabelText('Reward per release');
 expect(bchReward()).toHaveValue('0.00002000');
 fireEvent.change(bchReward(),{target:{value:'0.00003000'}});
 fireEvent.change(asset,{target:{value:'token'}});
 expect(tokenReward()).toHaveValue('1');
 fireEvent.change(tokenReward(),{target:{value:'2'}});
 fireEvent.change(asset,{target:{value:'bch'}});
 expect(bchReward()).toHaveValue('0.00003000');
 fireEvent.change(asset,{target:{value:'token'}});
 expect(tokenReward()).toHaveValue('2');
});
it.each(['create','offer'])('retains %s preflight errors and values through field corrections and status updates',async(kind)=>{
 if(kind==='create')window.location.hash='#/create';
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const button=await screen.findByRole('button',{name:kind==='create'?'Create Vault':'Make an Offer'});
 vi.mocked(wallet.queue!).mockRejectedValueOnce(Object.assign(Error('Error: Error: verified funding is reserved'),{details:{code:'creation-funding',available:'1000'}}));
 fireEvent.click(button);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('verified funding is reserved'));
 expect(screen.getByRole('alert')).not.toHaveTextContent('Error:');
 const field=screen.getByLabelText(kind==='create'?'Reward per release (min. 0.00001200 BCH)':'Requested reward');expect(field).toHaveValue('0.00002000');
 fireEvent.change(field,{target:{value:'0.00003000'}});await act(async()=>{window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Background progress'}));});
 expect(screen.getByRole('alert')).toHaveTextContent('verified funding is reserved');fireEvent.click(screen.getByRole('button',{name:'Dismiss Transaction Error'}));expect(screen.queryByText('verified funding is reserved')).toBeNull();
});
it('shows each offer validation failure beside its field',async()=>{
 await open();for(const name of ['Stake amount','Requested reward','Lock duration (time units)'])fireEvent.change(screen.getByLabelText(name),{target:{value:'0'}});
 expect(screen.getByRole('alert',{name:'stake error'})).toHaveTextContent('Stake must');expect(screen.getByRole('alert',{name:'reward error'})).toHaveTextContent('Requested reward must');expect(screen.getByRole('alert',{name:'duration error'})).toBeVisible();
});
it('shows a concise old-request blocker and a resolution action while preserving the 9600-satoshi form',async()=>{
 window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.change(screen.getByLabelText('Reward per release (min. 0.00001200 BCH)'),{target:{value:'0.00001200'}});fireEvent.change(screen.getByLabelText('Number of releases'),{target:{value:'8'}});
 const detail='Very long independently verified transaction diagnostic';vi.mocked(wallet.queue!).mockRejectedValueOnce(Object.assign(Error(detail),{summary:'An old request reserves 866201 satoshis. Resolve that request to continue creating this new vault.',details:{code:'creation-funding',reserved:'866201',reservations:[{id:'old',step:'seed-funding'}]}}));
 fireEvent.click(screen.getByRole('button',{name:'Create Vault'}));await screen.findByRole('button',{name:'Resolve old request'});
 expect(screen.getByText(detail)).not.toBeVisible();expect(screen.getByText('Technical details')).toBeVisible();expect(screen.getByRole('alert')).toHaveTextContent('An old request reserves 866201');
 let submitted=false,confirmed=false;const rec={id:'recovery',intent:{kind:'recover',operationId:'old'},recovery:{operationId:'old'},owner:{publicKey:owner},step:'wallet-recovery',stage:'pending',raw:'new',txid:'ff'.repeat(32)};
 vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='list')return submitted?[{...rec,stage:confirmed?'confirmed':'pending',recoveryResolved:confirmed}]:[];if(i.operation==='reconcileRecovery'){confirmed=true;return {...rec,stage:'confirmed',recoveryResolved:true};}return [];});
 vi.mocked(wallet.queue!).mockImplementationOnce(async()=>{submitted=true;return rec;});
 fireEvent.click(screen.getByRole('button',{name:'Resolve old request'}));await waitFor(()=>expect(wallet.queue).toHaveBeenLastCalledWith({operation:'prepare',intent:{kind:'recover',operationId:'old'}},expect.any(Function)));
 expect(screen.getByLabelText('Reward per release (min. 0.00001200 BCH)')).toHaveValue('0.00001200');expect(screen.getByLabelText('Number of releases')).toHaveValue(8);expect(screen.getByText('0.00009600 BCH')).toBeVisible();await screen.findByRole('button',{name:'Continue Create Vault'});expect(screen.getByRole('status')).toHaveTextContent('Old request resolved');
});
it('offers Continue Create Vault only after confirmed resolution',async()=>{
 window.location.hash='#/create';const recovery={id:'r',intent:{kind:'recover',operationId:'old'},step:'wallet-recovery',stage:'pending',raw:'new',txid:'ff'.repeat(32),owner:{publicKey:owner},recovery:{operationId:'old'},recoveryResolved:false};let confirmed=false;
 vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='list')return [{...recovery,stage:confirmed?'confirmed':'pending',recoveryResolved:confirmed}];if(i.operation==='reconcileRecovery'){confirmed=true;return {...recovery,stage:'confirmed',recoveryResolved:true};}return [];});
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);await screen.findByRole('button',{name:'Continue Create Vault'});expect(confirmed).toBe(true);expect(wallet.queue).not.toHaveBeenCalled();
});
it('distinguishes a confirmed self-send from covenant references that still need inspection',async()=>{
 window.location.hash='#/create';vi.mocked(queueCall).mockImplementation(async i=>i.operation==='list'?[{id:'r',intent:{kind:'recover',operationId:'old'},step:'wallet-recovery',stage:'confirmed',raw:'new',owner:{publicKey:owner},recoveryResolved:false,error:'The old request address already holds covenant funds.'}]:[]);
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 expect(await screen.findByText(/wallet self-send confirmed/)).toBeVisible();expect(screen.queryByRole('button',{name:'Continue Create Vault'})).toBeNull();expect(screen.getByRole('button',{name:'Create Vault'})).toBeEnabled();expect(wallet.queue).not.toHaveBeenCalled();
});
it('provides an explicit retry for an interrupted signed resolution without retrying the old transaction',async()=>{
 window.location.hash='#/create';const rec={id:'new-resolution',intent:{kind:'recover',operationId:'old'},step:'wallet-recovery',stage:'signed',raw:'new-signed-self-send',owner:{publicKey:owner},recovery:{operationId:'old'}};
 vi.mocked(queueCall).mockImplementation(async i=>i.operation==='list'?[rec]:i.operation==='reconcileRecovery'?rec:[]);
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);fireEvent.click(await screen.findByRole('button',{name:'Retry signed resolution'}));await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'resume',id:'new-resolution',retry:true},expect.any(Function)));
});

it('cancels an offline request when form values change and then change back',async()=>{
 live=false;await open();fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());
 fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00004000'}});fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00003000'}});live=true;
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('request changed'));expect(wallet.queue).not.toHaveBeenCalled();
});
it('a page restored from interruption cannot resume an old request',async()=>{
 live=false;await open();fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());
 act(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});live=true;
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('request changed'));expect(wallet.queue).not.toHaveBeenCalled();
});

it('allows cancelling a stranded unsigned reservation without signing or deleting its journal',async()=>{
 const unsigned={id:'unsigned',intent:{kind:'create'},owner:{publicKey:owner},stage:'review',signing:'unsigned',step:'action'};
 vi.mocked(queueCall).mockImplementation(async i=>i.operation==='list'?[unsigned]:i.operation==='owned'?[]:snapshot);
 await open();vi.mocked(wallet.queue!).mockRejectedValueOnce(Object.assign(Error('Reserved by unsigned request'),{details:{reservations:[{id:'unsigned',step:'action'}]}}));
 fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));fireEvent.click(await screen.findByRole('button',{name:'Cancel unsigned request'}));
 await waitFor(()=>expect(queueCall).toHaveBeenCalledWith({operation:'discard',id:'unsigned'}));expect(wallet.queue).toHaveBeenCalledTimes(1);
});

function renderPairedCreation(connected=false) {
 HTMLDialogElement.prototype.showModal = vi.fn(function(this:HTMLDialogElement) { this.setAttribute('open',''); });
 const node=deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88)));
 const encoded=encodeHdPublicKey({node,network:'testnet'});
 if(typeof encoded==='string')throw Error(encoded);
 const paths=[{name:'receive',xpub:encoded.hdPublicKey}];
 const paired={...wallet,publicPaths:()=>paths};
 window.location.hash='#/create';
 live=connected;
 render(<WalletTransactionsContext.Provider value={paired}><QueueArena/></WalletTransactionsContext.Provider>);
}

it('asks for a live connection when the pairing has no saved public paths',async()=>{
 live=false;
 window.location.hash='#/create';
 render(<WalletTransactionsContext.Provider value={{...wallet,publicPaths:()=>undefined}}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.click(await screen.findByRole('button',{name:'Create Vault'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('no usable saved wallet addresses');
 expect(wallet.restore).toHaveBeenCalledOnce();
 expect(wallet.queue).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Create Vault'})).toBeEnabled();
});

it('reports funding errors from saved public paths while Cashonize is offline',async()=>{
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='previewCreate')throw Error('Chipnet funding service unavailable');
  return [];
 });
 renderPairedCreation();
 fireEvent.click(await screen.findByRole('button',{name:'Create Vault'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Chipnet funding service unavailable');
 expect(queueCall).toHaveBeenCalledWith(expect.objectContaining({operation:'previewCreate'}),expect.arrayContaining([
  expect.objectContaining({path:'receive',index:0,publicKey:expect.stringMatching(/^(02|03)[a-f0-9]{64}$/)}),
 ]));
 expect(wallet.queue).not.toHaveBeenCalled();
 expect(wallet.restore).not.toHaveBeenCalled();
});

it.each([
 {connected:false,decision:'continue'},{connected:false,decision:'cancel'},{connected:true,decision:'continue'},
])('reviews estimated costs before signing (connected=$connected, $decision)',async ({connected,decision})=>{
 const quote={transactions:1,approvals:1,preparationFees:[],creationFee:'400',totalFee:'400',walletDebit:'24000',reserve:'20000',rewardCategory:zero};
 vi.mocked(queueCall).mockImplementation(async (request,keys)=>{
  if(request.operation==='previewCreate')return {id:'offline-review',intent:request.intent,network:'chipnet',keys,owner:keys![0],
   step:'action',stage:'review',signing:'unsigned',plan:{fee:'400',label:'Create vault'},quote};
  return [];
 });
 renderPairedCreation(connected);
 fireEvent.click(await screen.findByRole('button',{name:'Create Vault'}));
 const review=await screen.findByRole('dialog',{}, {timeout:5000});
 expect(review).toHaveTextContent('Expected wallet approvals');
 expect(screen.getByText('Estimated network fee: 400 sats')).toBeVisible();
 // Wallet availability while reading the quote cannot itself trigger approval.
 live=true;
 expect(wallet.restore).not.toHaveBeenCalled();
 expect(wallet.queue).not.toHaveBeenCalled();
 fireEvent.click(within(review).getByRole('button',{name:decision==='continue'?/Continue with 1 approval/:'Cancel'}));
 if(decision==='continue'){
  await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({
   operation:'continueCreate',draft:expect.objectContaining({id:'offline-review',quote}),
  },expect.any(Function)));
 }else{
  await waitFor(()=>expect(screen.getByRole('button',{name:'Create Vault'})).toBeEnabled());
  expect(wallet.queue).not.toHaveBeenCalled();
  expect(vi.mocked(queueCall).mock.calls.map(([request])=>request.operation)).not.toContain('discard');
 }
});

it('keeps creation status below the form and removes the submission label after confirmation',async()=>{
 window.location.hash='#/v3';
 const submitted={id:'new-vault',intent:{kind:'create'},step:'action',stage:'pending',raw:'retained',txid:genesis,config};
 let journal:typeof submitted[]=[];
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='list')return journal;
  if(request.operation==='creationStatus')return {confirmed:true};
  return snapshot;
 });
 vi.mocked(wallet.queue!).mockImplementationOnce(async ()=>{
  journal=[submitted];
  return submitted;
 });
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const submit=screen.getByRole('button',{name:/^Create Vault$/});
 fireEvent.click(submit);
 const status=await screen.findByRole('region',{name:'Vault creation status'});
 expect(submit.compareDocumentPosition(status)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await within(status).findByText(/Confirmed on-chain/);
 expect(within(status).queryByText(/Submitted/)).toBeNull();
 expect(within(status).getByRole('link',{name:/Vault/})).toHaveAttribute('href','#/v3/vault/'+genesis);
 fireEvent.click(await screen.findByRole('dialog',{name:'Your vault has been created.'}));
 await screen.findByRole('heading',{name:'Known vaults'});
 expect(screen.queryByText(/Submitted/)).toBeNull();
});

it('uses token tickers outside the full reward asset identity',async()=>{
 const category='a7'.repeat(32),name='Arena Token',symbol='ARN';
 const tokenConfig={...config,anchor:{...config.anchor,genesis:'ac'.repeat(32)},parameters:{...config.parameters,stakingCategory:category,rewardCategory:category}};
 const bchVault={...config,anchor:{...config.anchor,genesis:'57'.repeat(32)}};
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[{...tokenConfig,rewardSnapshot:{network:'chipnet',vaultId:tokenConfig.anchor.genesis,remaining:'20000',updatedAt:new Date().toISOString() }},bchVault],pages:[]});
 vi.mocked(queueCall).mockImplementation(async request=>
  request.operation==='list'||request.operation==='owned'?[]:{...snapshot,config:tokenConfig});
 const fetchToken=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({name,token:{category,symbol,decimals:2}})));
 try{
  window.location.hash='#/v3/offers';
  render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
  await waitFor(()=>expect(document.querySelector('td[data-label="Reward remaining"]')).toHaveTextContent('200 '+symbol));
  expect(screen.getByText(symbol)).toBeVisible();
  fireEvent.click(screen.getByRole('link',{name:'Vault 1'}));
  const detail=await screen.findByRole('region',{name:'Vault details'});
  expect(within(detail).getByText('Reward asset').nextElementSibling).toHaveTextContent(`${name} (${symbol}) [${category}]`);
  expect(within(detail).getByText('Staking asset').nextElementSibling).toHaveTextContent(symbol);
  expect(within(detail).getByText('Remaining reserve').nextElementSibling).toHaveTextContent('200 '+symbol);
  expect(within(detail).getByText('Total reward currently available for claiming').nextElementSibling).toHaveTextContent('200 '+symbol);
  expect(within(screen.getByRole('region',{name:/^Queue$/})).getByText('20 '+symbol)).toBeVisible();
  expect(screen.getByLabelText('Requested reward')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'30'}});
  fireEvent.change(screen.getByLabelText('Requested reward'),{target:{value:'201'}});
  const submit=screen.getByRole('button',{name:'Make an Offer'});
  expect(submit).toBeDisabled();
  expect(screen.getByRole('alert',{name:'reward error'})).toHaveTextContent('200 ARN');
  fireEvent.change(screen.getByLabelText('Requested reward'),{target:{value:'20'}});
  fireEvent.click(submit);
  await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'insert',config:tokenConfig,terms:{stake:3000n,reward:2000n,duration:512}}},expect.any(Function)));
  expect(fetchToken).toHaveBeenCalledTimes(1);
  expect(fetchToken).toHaveBeenCalledWith('https://bcmr-chipnet.paytaca.com/api/tokens/'+category+'/',expect.anything());
  fireEvent.click(screen.getByRole('link',{name:'Browse All Vaults'}));
  fireEvent.click(await screen.findByRole('link',{name:'Vault 2'}));
  expect(await screen.findByLabelText('Requested reward')).toHaveValue('0.00002000');
  fireEvent.click(screen.getByRole('link',{name:'Browse All Vaults'}));
  fireEvent.click(await screen.findByRole('link',{name:'Vault 1'}));
  expect(await screen.findByLabelText('Requested reward')).toHaveValue('20');
 }finally{fetchToken.mockRestore();}
});

it('shows the published count before the first blockchain reply and retains it on failure',async()=>{
 window.location.hash='#/v3/offers';
 const vaultId='77'.repeat(32),listed={...config,anchor:{...config.anchor,genesis:vaultId}};
 const updatedAt=new Date(Date.now()-20*60*1000).toISOString();
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[{...listed,offerCount:{network:'chipnet',vaultId,waiting:7,updatedAt}}],pages:[]});
 let reject!: (error:Error)=>void;
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='catalog'?new Promise((_resolve,fail)=>{reject=fail;}):[]);
 render(<QueueArena/>);
 const table=await screen.findByRole('table');
 await waitFor(()=>expect(within(table).getByRole('cell',{name:/^7 · Stale/})).toBeVisible());
 await waitFor(()=>expect(reject).toBeDefined());
 await act(async()=>reject(Error('Provider unavailable')));
 expect(within(table).getByTitle(/Queue data unavailable/)).toHaveTextContent('7 · Stale');
 expect(screen.queryByText('Verifying…')).toBeNull();
});

it('finds active offers before history, checks the owner and initiates cancellation',async()=>{
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='owned'?new Promise(()=>{}):request.operation==='reportedQueue'?snapshot:[]);
 const view=render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const cancel=await screen.findByRole('button',{name:'Cancel offer'});
 expect(cancel).toBeEnabled();
 expect(screen.getByText(/Provider-reported queue/)).toBeVisible();
 expect(screen.getByText(/Wallet .*Chipnet/)).toBeVisible();
 vi.mocked(wallet.queue!).mockRejectedValueOnce(Error('Conflicting blockchain evidence'));
 fireEvent.click(cancel);
 await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'cancel',config,offerId:offer.id}},expect.any(Function)));
 expect(await screen.findByText('Conflicting blockchain evidence')).toBeVisible();
 const other='03'+'22'.repeat(32);
 view.rerender(<WalletTransactionsContext.Provider value={{...wallet,publicKey:()=>other,pairing:()=>({paired:true,live:true,identity:other,network:'chipnet'})}}><QueueArena/></WalletTransactionsContext.Provider>);
 expect(screen.queryByRole('button',{name:'Cancel offer'})).toBeNull();
 view.rerender(<WalletTransactionsContext.Provider value={{...wallet,pairing:()=>({paired:true,live:true,identity:owner,network:'mainnet'})}}><QueueArena/></WalletTransactionsContext.Provider>);
 expect(screen.queryByRole('button',{name:'Cancel offer'})).toBeNull();
});

it('merges a journaled pending offer into the queue row as soon as it is reported',async()=>{
 const pending={id:'offer-op',owner:{publicKey:owner},intent:{kind:'insert',config,terms:offer},raw:'retained',offerId:offer.id,stage:'pending'};
 let report=()=>new Promise<typeof snapshot>(()=>{});
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='list'?[pending]:request.operation==='reportedQueue'?report():[]);
 const view=render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 window.location.hash='#/v3/my-offers';
 await act(async()=>window.dispatchEvent(new HashChangeEvent('hashchange')));
 let panel=screen.getByRole('heading',{name:'My Offers'}).closest('section')!;
 await waitFor(()=>expect(within(panel).getByText('Pending',{selector:'strong'})).toBeVisible());
 expect(within(panel).queryByRole('button',{name:'Cancel offer'})).toBeNull();
 report=async()=>snapshot;
 await act(async()=>{window.location.hash='#/v3/vault/'+genesis;window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(await screen.findByText('Waiting',{selector:'strong'})).toBeVisible();
 panel=screen.getByRole('heading',{name:'My offers in this Vault'}).closest('section')!;
 expect(within(panel).queryByText('Pending',{selector:'strong'})).toBeNull();
 expect(within(panel).getAllByRole('article')).toHaveLength(1);
 view.unmount();
});

it('keeps published vault configuration visible through failed verification and retries in place',async()=>{
 let finish!: (value:typeof snapshot)=>void;
 failure=true;
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation!=='reportedQueue')return [];
  if(failure)throw Object.assign(Error('Worker crashed'),{recoveryExhausted:true});
  return new Promise<typeof snapshot>(resolve=>{finish=resolve;});
 });
 render(<QueueArena/>);
 const details=await screen.findByRole('region',{name:'Vault details'});
 expect(within(details).getByText('Published configuration')).toBeVisible();
 for(const label of ['Staking asset','Reward asset','Total max reward','Reward per release','Release interval','Scheduled releases','Starts (local time)']){
  expect(within(details).getByText(label)).toBeVisible();
 }
 expect(await within(details).findByText(/Live queue and reserve are unavailable/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
 failure=false;
 const retry=within(details).getByRole('button',{name:'Retry verification'});
 fireEvent.click(retry);
 expect(retry).toBeDisabled();
 await act(async()=>finish(snapshot));
 expect(within(details).getByText('Remaining reserve')).toBeVisible();
 expect(screen.getByText(/provisional · 1 waiting/)).toBeVisible();
 expect(within(details).queryByRole('button',{name:'Retry verification'})).toBeNull();
});

it('keeps the last reserve and ranking marked stale when a fresh read exhausts recovery',async()=>{
 await open();
 failure=true;
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='reportedQueue')throw Object.assign(Error('Worker crashed'),{recoveryExhausted:true});
  return [];
 });
 await act(async()=>{window.location.hash='#/v3/offers';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await act(async()=>{window.location.hash='#/v3/vault/'+genesis;window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(await screen.findByText(/Showing the last reported queue and reserve/)).toBeVisible();
 expect(screen.getByText('Remaining reserve')).toBeVisible();
 expect(screen.getByText(/1 waiting · Stale/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Claim reward'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
});


it('opens the creation notice when the public mempool row appears and temporarily highlights that row',async()=>{
 window.location.hash='#/v3';
 const previous=Array.from({length:20},(_,index)=>({...config,anchor:{...config.anchor,genesis:(index+1).toString(16).padStart(64,'0')}}));
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:previous,pages:[]});
 const submitted={id:'new-vault',intent:{kind:'create'},step:'action',stage:'pending',raw:'retained',txid:genesis,config};
 let journal:typeof submitted[]=[];
 let candidates:unknown[]=[];
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='list')return journal;
  if(request.operation==='creationStatus')return new Promise(()=>{});
  if(request.operation==='discoverMempool')return candidates;
  return snapshot;
 });
 vi.mocked(wallet.queue!).mockImplementationOnce(async()=>{journal=[submitted];return submitted;});
 vi.useFakeTimers();
 await act(async()=>{render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Create Vault'}));});
 expect(screen.getByText(/Public listing pending/)).toBeVisible();
 expect(screen.queryByRole('dialog')).toBeNull();
 candidates=[{config,height:-1,status:'provisional'}];
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 const notice=screen.getByRole('dialog',{name:'Your vault has been created.'});
 expect(notice.textContent).toBe('Your vault has been created.');
 expect(notice).toHaveAttribute('open');
 expect(screen.getByRole('heading',{name:'Create Vault'})).toBeVisible();
 fireEvent.click(within(notice).getByRole('heading'));
 expect(location.hash).toBe('#/v3/offers');
 expect(screen.queryByRole('dialog')).toBeNull();
 act(()=>vi.advanceTimersByTime(6000));
 fireEvent(window,new Event('hashchange'));
 expect(screen.getByRole('heading',{name:'Known vaults'})).toBeVisible();
 const row=screen.getByRole('link',{name:'Vault 21'}).closest('tr')!;
 expect(row).toHaveTextContent('Unconfirmed (0-conf) · Provisional');
 expect(row).toHaveClass('queue-row-highlight');
 expect(row).toHaveFocus();
 fireEvent.click(document.body);
 act(()=>vi.advanceTimersByTime(4999));
 expect(row).toHaveClass('queue-row-highlight');
 act(()=>vi.advanceTimersByTime(1));
 expect(row).not.toHaveClass('queue-row-highlight');
});

it('shows live vaults to a wallet-free visitor and updates or removes them on the next scan',async()=>{
 window.location.hash='#/v3/offers';
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[],pages:[]});
 localStorage.setItem('staking-arena-queue-configs-chipnet',JSON.stringify([{...config,parameters:{...config.parameters,cap:'2000'}}]));
 let candidates:unknown[]=[];
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='discoverMempool'?candidates:[]);
 vi.useFakeTimers();
 await act(async()=>{render(<QueueArena/>);});
 expect(screen.getByText('No linked-list vaults have been discovered yet.')).toBeVisible();
 expect(screen.queryByRole('link',{name:'Vault 1'})).toBeNull();
 candidates=[{config,height:0,status:'provisional'}];
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 const row=screen.getByRole('link',{name:'Vault 1'}).closest('tr')!;
 expect(row).toHaveTextContent('Unconfirmed (0-conf) · Provisional');
 expect(screen.queryByRole('dialog')).toBeNull();
 candidates=[{config,height:42,status:'observed-confirmed'}];
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(row).toBeVisible();
 expect(row).not.toHaveTextContent(/Unconfirmed|Confirmed on-chain/);
 candidates=[];
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(screen.queryByRole('link',{name:'Vault 1'})).toBeNull();
});

it('resumes a linked vault preparation and disables the recovery action during inspection',async()=>{
 window.location.hash='#/v3';
 const parent={id:'prep',intent:{kind:'create',parameters:config.parameters},step:'wallet-preparation',stage:'pending',
  raw:'saved preparation',txid:'71'.repeat(32),signing:'signed',owner:{publicKey:owner}};
 const child={...parent,id:'prep:next',parent:'prep',step:'action',stage:'review',raw:undefined,txid:undefined,signing:'unsigned'};
 let journal:unknown[]=[];
 let finish!:(value:typeof parent)=>void;
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='list')return journal;
  if(request.operation==='inspectSubmission')return request.id===parent.id?new Promise(resolve=>{finish=resolve;}):child;
  return [];
 });
 vi.mocked(wallet.queue!).mockImplementationOnce(async ()=>{
  journal=[parent,child];
  throw Object.assign(Error('Electrum providers synchronizing'),{details:{operationId:child.id,verification:'synchronizing'}});
 }).mockImplementationOnce(async()=>{
  const completed={...child,stage:'pending',signing:'signed',raw:'final',config,txid:genesis};
  journal=[parent,completed];return completed;
 });
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[],pages:[]});
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.click(screen.getByRole('button',{name:'Create Vault'}));
 const resume=await screen.findByRole('button',{name:'Resume Vault Creation'});
 expect(resume.nextElementSibling).toHaveTextContent('Dismiss Transaction Error');
 await waitFor(()=>expect(resume).toBeEnabled());
 fireEvent.click(resume);
 expect(resume).toBeDisabled();
 fireEvent.click(resume);
 await waitFor(()=>expect(finish).toBeTypeOf('function'));
 await act(async()=>finish(parent));
 await waitFor(()=>expect(wallet.queue).toHaveBeenLastCalledWith({operation:'resume',id:'prep',retry:true,recoverSubmission:true},expect.any(Function)));
 expect(wallet.queue).toHaveBeenCalledTimes(2);
 expect(await screen.findByText('Waiting for public listing…')).toBeVisible();
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('recognizes a publicly observed 0-conf vault after a lost acknowledgement',async()=>{
 window.location.hash='#/v3';
 const final={id:'final',intent:{kind:'create'},step:'action',stage:'signed',signing:'signed',
  raw:'retained',txid:genesis,config,owner:{publicKey:owner},error:'Broadcast acknowledgement unavailable'};
 let journal:unknown[]=[];
 let listed=false;
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[],pages:[]});
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='list')return journal;
  if(request.operation==='discoverMempool')return listed?[{config,height:-1,status:'provisional'}]:[];
  if(request.operation==='creationStatus')return {confirmed:false};
  return [];
 });
 vi.mocked(wallet.queue!).mockImplementationOnce(async()=>{
  journal=[final];
  throw Object.assign(Error(final.error),{details:{operationId:final.id}});
 });
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.click(screen.getByRole('button',{name:'Create Vault'}));
 expect(await screen.findByRole('button',{name:'Resume Vault Creation'})).toBeVisible();
 expect(screen.queryByRole('dialog')).toBeNull();
 listed=true;
 fireEvent.click(screen.getByRole('button',{name:'Refresh public discovery'}));
 const dialog=await screen.findByRole('dialog',{name:'Your vault has been created.'});
 fireEvent.click(dialog);
 await screen.findByRole('heading',{name:'Known vaults'});
 expect(screen.getByRole('link',{name:'Vault 1'}).closest('tr')).toHaveClass('queue-row-highlight');
 expect(wallet.queue).toHaveBeenCalledTimes(1);
 expect(vi.mocked(queueCall).mock.calls.some(([r])=>r.operation==='inspectSubmission')).toBe(false);
});

it('checks an interrupted offer without opening the wallet while verification is pending',async()=>{
 await open();
 const saved={id:'offer-signed',intent:{kind:'insert',config,terms:offer},step:'action',stage:'signed',raw:'retained',
  txid:'73'.repeat(32),owner:{publicKey:owner},error:'Provider unavailable'};
 let journal:unknown[]=[];
 vi.mocked(queueCall).mockImplementation(async request=>{
  if(request.operation==='list')return journal;
  if(request.operation==='inspectSubmission'){
   const waiting={...saved,error:'Waiting for network verification…',submissionRecovery:'waiting-verification'};
   journal=[waiting];return waiting;
  }
  return request.operation==='reportedQueue'?snapshot:[];
 });
 vi.mocked(wallet.queue!).mockImplementationOnce(async()=>{
  journal=[saved];throw Object.assign(Error(saved.error),{details:{operationId:saved.id,verification:'unavailable'}});
 });
 fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));
 const resume=await screen.findByRole('button',{name:'Resume Offer Submission'});
 expect(resume.nextElementSibling).toHaveTextContent('Dismiss Transaction Error');
 live=false;
 await waitFor(()=>expect(resume).toBeEnabled());
 fireEvent.click(resume);
 await waitFor(()=>expect(resume).toBeEnabled());
 expect(screen.getAllByText('Waiting for network verification…').length).toBeGreaterThan(0);
 expect(wallet.queue).toHaveBeenCalledTimes(1);
 expect(wallet.restore).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Dismiss Transaction Error'}));
 expect(vi.mocked(queueCall).mock.calls.some(([r])=>['discard','submit'].includes(String(r.operation)))).toBe(false);
 expect(screen.getByRole('button',{name:'Resume Offer Submission'})).toBeVisible();
});

it('opens transaction details for a conflict instead of offering a retry',async()=>{
 window.location.hash='#/v3';
 const conflict={id:'conflict',intent:{kind:'create'},step:'wallet-preparation',stage:'conflict',raw:'retained',
  txid:'74'.repeat(32),owner:{publicKey:owner},error:'Confirmed competing spend'};
 vi.mocked(queueCall).mockImplementation(async r=>r.operation==='list'?[conflict]:[]);
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const inspect=await screen.findByRole('button',{name:'Inspect Transaction'});
 expect(screen.queryByRole('button',{name:'Resume Vault Creation'})).toBeNull();
 fireEvent.click(inspect);
 expect(screen.getByText(/Transaction recovery/).parentElement).toHaveAttribute('open');
 expect(screen.getByText('Inspection details').parentElement).toHaveAttribute('open');
 expect(wallet.queue).not.toHaveBeenCalled();
});

it('retries a vault preflight after provider failure when there is no saved transaction',async()=>{
 window.location.hash='#/v3';
 vi.mocked(wallet.queue!).mockRejectedValueOnce(Object.assign(Error('Provider unavailable'),{details:{verification:'unavailable'}}))
  .mockRejectedValueOnce(Error('No usable wallet funds'));
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.click(screen.getByRole('button',{name:'Create Vault'}));
 const resume=await screen.findByRole('button',{name:'Resume Vault Creation'});
 expect(resume.nextElementSibling).toHaveTextContent('Dismiss Transaction Error');
 fireEvent.click(resume);
 expect(await screen.findByText('No usable wallet funds')).toBeVisible();
 expect(wallet.queue).toHaveBeenCalledTimes(2);
 expect(vi.mocked(wallet.queue!).mock.calls[0]![0]).toEqual(vi.mocked(wallet.queue!).mock.calls[1]![0]);
 expect(vi.mocked(queueCall).mock.calls.some(([r])=>r.operation==='inspectSubmission')).toBe(false);
});

it('shows the live score and highlights a locally submitted offer before the provider reports it',async()=>{
 await open();
 const form=screen.getByRole('heading',{name:'Make an Offer'}).closest('form')!;
 expect(form.querySelector('h2')?.nextElementSibling).toHaveTextContent('Priority Score = (Stake Amount × Lock Duration) / Requested Reward');
 const priority=form.querySelector('#queue-priority-preview');
 expect(priority).toHaveTextContent('Priority Score: 1.5');
 fireEvent.change(screen.getByLabelText('Lock duration (time units)'),{target:{value:'2'}});
 expect(priority).toHaveTextContent('Priority Score: 3');
 fireEvent.change(screen.getByLabelText('Requested reward'),{target:{value:'0.00001000'}});
 expect(priority).toHaveTextContent('Priority Score: 6');
 fireEvent.change(screen.getByLabelText('Requested reward'),{target:{value:'0'}});
 expect(priority).toHaveTextContent('Priority Score: —');
 fireEvent.change(screen.getByLabelText('Requested reward'),{target:{value:'0.00002000'}});

 const next={...offer,id:'fe'.repeat(32),duration:1024};
 const result={id:'new-offer',intent:{kind:'insert',config,terms:next},stage:'pending',step:'action',raw:'retained',offerId:next.id,txid:'ff'.repeat(32),owner:{publicKey:owner}};
 let reportNext!:(value:typeof snapshot)=>void;
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='reportedQueue'?new Promise(resolve=>{reportNext=resolve;}):request.operation==='list'?[result]:[]);
 vi.mocked(wallet.queue!).mockResolvedValueOnce(result);
 fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));
 const notice=await screen.findByRole('dialog',{name:'Your offer has been submitted.'});
 const pending=document.getElementById('offer-row-'+next.id)!;
 expect(pending).toHaveTextContent('PendingAwaiting provider update');
 expect(screen.getByText(/1 waiting/)).toBeVisible();
 fireEvent.click(notice); // The native dialog receives clicks on its backdrop.
 const table=screen.getByRole('table',{name:'Ranked queue'});
 expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['Rank','Priority Score','Reward','Stake','Lock duration']);
 expect(pending).toHaveClass('queue-row-highlight');
 expect(pending).toHaveFocus();
 expect(within(pending).getAllByRole('cell')[1]).toHaveTextContent(/^3$/);
 expect(screen.queryByRole('dialog')).toBeNull();
 await act(async()=>reportNext({...snapshot,ordered:[next,offer]}));
 expect(document.getElementById('offer-row-'+next.id)).toBe(pending);
 expect(within(pending).getAllByRole('cell')[0]).toHaveTextContent(/^1$/);
 expect(pending).toHaveClass('queue-row-highlight');
 expect(queueCall).not.toHaveBeenCalledWith(expect.objectContaining({channel:'notices'}),expect.anything(),expect.anything());
});

it.each(['Enter',' ','Escape'])('restores a pending offer and dismisses its confirmation with %j',async key=>{
 const journal={id:'new-offer',intent:{kind:'insert',config,terms:offer},stage:'pending',step:'action',raw:'retained',offerId:offer.id,txid:'ff'.repeat(32),owner:{publicKey:owner}};
 sessionStorage.setItem('stake-arena-notices-chipnet',JSON.stringify([{kind:'offer',vaultId:genesis,offerId:offer.id,txid:journal.txid}]));
 const arena=<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>;
 window.location.hash='#/v3';
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='list'?[journal]:request.operation==='reportedQueue'?new Promise(()=>{}):[]);
 const view=render(arena);
 const notice=await screen.findByRole('dialog',{name:'Your offer has been submitted.'});
 fireEvent.keyDown(within(notice).getByRole('button'),{key});
 expect(location.hash).toBe('#/v3/vault/'+genesis);
 const row=await screen.findByText('Awaiting provider update');
 expect(row.closest('tr')).toHaveClass('queue-row-highlight');
 view.unmount();
 render(arena);
 await screen.findByText('Awaiting provider update');
 expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
 ['rejected',{stage:'review',signing:'rejected',raw:undefined}],
 ['unsigned',{stage:'review',signing:'unsigned',raw:undefined}],
 ['failed',{stage:'signed',error:'Broadcast failed'}],
 ['conflicted',{stage:'conflict'}],
])('omits success and the local queue row for %s transactions',async (_label,status)=>{
 await open();
 const next={...offer,id:'fe'.repeat(32)};
 const result={id:'new-offer',intent:{kind:'insert',config,terms:next},step:'action',raw:'retained',offerId:next.id,txid:'ff'.repeat(32),owner:{publicKey:owner},...status};
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='list'?[result]:request.operation==='reportedQueue'?snapshot:[]);
 vi.mocked(wallet.queue!).mockResolvedValueOnce(result);
 const submit=screen.getByRole('button',{name:'Make an Offer'});
 fireEvent.click(submit);
 await waitFor(()=>expect(wallet.queue).toHaveBeenCalled());
 if(_label==='conflicted')await screen.findByRole('button',{name:'Inspect Transaction'});
 else await waitFor(()=>expect(screen.getByRole('button',{name:'Resume Offer Submission'})).toBeEnabled());
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(document.getElementById('offer-row-'+next.id)).toBeNull();
});


it('shows published rewards immediately and refreshes cells without replacing the row',async()=>{
 window.location.hash='#/v3/offers';
 const boundary=config.parameters.epoch+2*config.parameters.interval;
 const vaultId='ab'.repeat(32),listed={...config,anchor:{...config.anchor,genesis:vaultId}};
 const updatedAt=new Date(Date.now()-20*60*1000).toISOString();
 const cached={network:'chipnet' as const,vaultId,remaining:'20000',schedule:{available:'2000',nextRelease:boundary},updatedAt};
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[{...listed,rewardSnapshot:cached}],pages:[]});
 let observe!: (value:CatalogObservation)=>void;
 vi.mocked(queueCall).mockImplementation(async (request,_keys,_signal,receive)=>{
  if(request.operation==='catalog'){observe=receive!;return new Promise(()=>{});}
  return [];
 });
 render(<QueueArena/>);
 const table=await screen.findByRole('table');
 expect(within(table).getAllByRole('columnheader').map(header=>header.textContent)).toEqual([
  'Vault','Reward remaining','Next reward release','Reward available for claiming','Staking asset','Offers',
 ]);
 const row=(await within(table).findByRole('link',{name:'Vault 1'})).closest('tr')!;
 expect(row.querySelector('td[data-label="Reward remaining"]')).toHaveTextContent('0.00020000 BCH · Stale');
 expect(screen.getByText(/Last updated:/).querySelector('time')).toHaveAttribute('datetime',updatedAt);
 const refreshedAt=new Date().toISOString();
 await act(async()=>observe({vaultId,kind:'reward',reward:{...cached,remaining:'19000',schedule:{available:'1000',nextRelease:boundary},updatedAt:refreshedAt}}));
 expect(row.querySelector('td[data-label="Reward remaining"]')).toHaveTextContent('0.00019000 BCH');
 expect(row.querySelector('td[data-label="Reward available for claiming"]')).toHaveTextContent('0.00001000 BCH');
 expect(row.querySelector('td[data-label="Next reward release"] time')).toHaveAttribute('datetime',new Date(boundary*1000).toISOString());
 expect(screen.getByText(/Last updated:/).querySelector('time')).toHaveAttribute('datetime',refreshedAt);
 expect(within(table).getByRole('link',{name:'Vault 1'}).closest('tr')).toBe(row);
 expect(queueCall).not.toHaveBeenCalledWith(expect.objectContaining({operation:'reportedQueue'}),[],expect.any(AbortSignal));
});
