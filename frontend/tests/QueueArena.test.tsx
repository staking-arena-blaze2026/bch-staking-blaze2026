import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey} from '@bitauth/libauth';
import {render,screen,waitFor,fireEvent,cleanup,act,within} from '@testing-library/react';
vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet'}));
vi.mock('../src/queueClient',()=>({queueCall:vi.fn()}));
vi.mock('../src/queueCatalog',async importOriginal=>({...await importOriginal<typeof import('../src/queueCatalog')>(),loadQueuePage:vi.fn()}));
import {queueCall} from '../src/queueClient';
import {loadQueuePage} from '../src/queueCatalog';
import QueueArena from '../src/QueueArena';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
const zero='00'.repeat(32),owner='02'+'11'.repeat(32),genesis='aa'.repeat(32);
const config={parameters:{stakingCategory:zero,rewardCategory:zero,epoch:1800000000,interval:60,releases:10,cap:2000n},identity:{vault:'bb'.repeat(32),queue:'cc'.repeat(32)},anchor:{genesis,creator:owner}};
const offer={id:'dd'.repeat(32),owner,stake:3000n,duration:512,reward:2000n,next:{id:zero,stake:0n,duration:0,reward:0n}};
const snapshot={config,tip:{height:200,hash:'ee'.repeat(32)},mtp:1800001200,state:{head:offer,reserve:20000n},ordered:[offer],nodes:new Map(),vault:{},root:{}};
let live=true,rows:any[]=[],failure=false;
const wallet:WalletTransactions={publicKey:()=>owner,pairing:()=>({paired:true,live,identity:owner,network:'chipnet'}),restore:vi.fn(),v3:vi.fn(),queue:vi.fn(async()=>({intent:{kind:'insert'},stage:'pending',step:'action',raw:'retained',txid:'ff'.repeat(32)})),execute:vi.fn()};
beforeEach(()=>{vi.spyOn(document,'hidden','get').mockReturnValue(false);localStorage.clear();rows=[];live=true;failure=false;vi.clearAllMocks();window.location.hash='#/v3/vault/'+genesis;vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[config],pages:[]});vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='list')return [];if(i.operation==='owned')return rows;if(failure)throw Error('Provider unavailable');return snapshot;});});
afterEach(cleanup);
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
it.each(['create','offer'])('retains %s preflight errors and values through field corrections and status updates',async(kind)=>{
 if(kind==='create')window.location.hash='#/create';
 render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const button=await screen.findByRole('button',{name:kind==='create'?'Create Vault':'Make an Offer'});
 vi.mocked(wallet.queue!).mockRejectedValueOnce(Object.assign(Error('Error: Error: verified funding is reserved'),{details:{code:'creation-funding',available:'1000'}}));
 fireEvent.click(button);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('verified funding is reserved'));
 expect(screen.getByRole('alert')).not.toHaveTextContent('Error:');
 const field=screen.getByLabelText(kind==='create'?'Reward per release (min. 0.00001200 BCH)':'Requested reward');expect(field).toHaveValue('0.00002000');
 fireEvent.change(field,{target:{value:'0.00003000'}});await act(async()=>{window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Background progress'}));});
 expect(screen.getByRole('alert')).toHaveTextContent('verified funding is reserved');fireEvent.click(screen.getByRole('button',{name:'Dismiss transaction error'}));expect(screen.queryByText('verified funding is reserved')).toBeNull();
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
 fireEvent.click(screen.getByRole('link',{name:'Browse All Vaults'}));
 await screen.findByRole('heading',{name:'Known vaults'});
 expect(screen.queryByText(/Submitted/)).toBeNull();
});

it('uses token tickers outside the full reward asset identity',async()=>{
 const category='a7'.repeat(32),name='Arena Token',symbol='ARN';
 const tokenConfig={...config,parameters:{...config.parameters,stakingCategory:category,rewardCategory:category}};
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[tokenConfig],pages:[]});
 vi.mocked(queueCall).mockImplementation(async request=>
  request.operation==='list'||request.operation==='owned'?[]:{...snapshot,config:tokenConfig});
 const fetchToken=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({name,token:{category,symbol,decimals:2}})));
 try{
  window.location.hash='#/v3/offers';
  render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
  expect(await screen.findByText('200 '+symbol)).toBeVisible();
  expect(screen.getByText(symbol)).toBeVisible();
  fireEvent.click(screen.getByRole('link',{name:'Vault 1'}));
  const detail=await screen.findByRole('region',{name:'Vault details'});
  expect(within(detail).getByText('Reward asset').nextElementSibling).toHaveTextContent(`${name} (${symbol}) [${category}]`);
  expect(within(detail).getByText('Staking asset').nextElementSibling).toHaveTextContent(symbol);
  expect(within(detail).getByText('Remaining reserve').nextElementSibling).toHaveTextContent('200 '+symbol);
  expect(within(detail).getByText('Total reward currently available for claiming').nextElementSibling).toHaveTextContent('200 '+symbol);
  expect(within(screen.getByRole('region',{name:/^Queue$/})).getByText('20 '+symbol)).toBeVisible();
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
 }finally{fetchToken.mockRestore();}
});

it('shows the published count before the first blockchain reply and retains it on failure',async()=>{
 window.location.hash='#/v3/offers';
 vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[{...config,offerCount:{network:'chipnet',vaultId:genesis,waiting:7,updatedAt:new Date().toISOString()}}],pages:[]});
 let reject!: (error:Error)=>void;
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='reportedQueue'?new Promise((_resolve,fail)=>{reject=fail;}):[]);
 render(<QueueArena/>);
 const table=await screen.findByRole('table');
 await waitFor(()=>expect(within(table).getByRole('cell',{name:'7'})).toBeVisible());
 await waitFor(()=>expect(reject).toBeDefined());
 await act(async()=>reject(Error('Malformed or cyclic link')));
 expect(within(table).getByTitle(/Inconsistent queue data/)).toHaveTextContent('7');
 expect(screen.queryByText('Verifying…')).toBeNull();
});

it('finds active offers before history, checks the owner and initiates cancellation',async()=>{
 vi.mocked(queueCall).mockImplementation(async request=>request.operation==='owned'?new Promise(()=>{}):request.operation==='reportedQueue'?snapshot:[]);
 const view=render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 const cancel=await screen.findByRole('button',{name:'Cancel'});
 expect(cancel).toBeEnabled();
 expect(screen.getByText(/Provider-reported queue/)).toBeVisible();
 expect(screen.getByText(/Wallet .*Chipnet/)).toBeVisible();
 vi.mocked(wallet.queue!).mockRejectedValueOnce(Error('Conflicting blockchain evidence'));
 fireEvent.click(cancel);
 await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'cancel',config,offerId:offer.id}},expect.any(Function)));
 expect(await screen.findByText('Conflicting blockchain evidence')).toBeVisible();
 const other='03'+'22'.repeat(32);
 view.rerender(<WalletTransactionsContext.Provider value={{...wallet,publicKey:()=>other,pairing:()=>({paired:true,live:true,identity:other,network:'chipnet'})}}><QueueArena/></WalletTransactionsContext.Provider>);
 expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();
 view.rerender(<WalletTransactionsContext.Provider value={{...wallet,pairing:()=>({paired:true,live:true,identity:owner,network:'mainnet'})}}><QueueArena/></WalletTransactionsContext.Provider>);
 expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();
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
 expect(within(panel).queryByRole('button',{name:'Cancel'})).toBeNull();
 report=async()=>snapshot;
 await act(async()=>{window.location.hash='#/v3/vault/'+genesis;window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(await screen.findByText('Waiting',{selector:'strong'})).toBeVisible();
 panel=screen.getByRole('heading',{name:'My Offers'}).closest('section')!;
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
