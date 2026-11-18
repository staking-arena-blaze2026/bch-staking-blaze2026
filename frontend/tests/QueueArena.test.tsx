import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor,fireEvent,cleanup,act} from '@testing-library/react';
vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet'}));
vi.mock('../src/queueClient',()=>({queueCall:vi.fn()}));
vi.mock('../src/queueCatalog',()=>({loadQueuePage:vi.fn()}));
import {queueCall} from '../src/queueClient';
import {loadQueuePage} from '../src/queueCatalog';
import QueueArena from '../src/QueueArena';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
const zero='00'.repeat(32),owner='02'+'11'.repeat(32),genesis='aa'.repeat(32);
const config={parameters:{stakingCategory:zero,rewardCategory:zero,epoch:1800000000,interval:60,releases:10,cap:2000n},identity:{vault:'bb'.repeat(32),queue:'cc'.repeat(32)},anchor:{genesis,creator:owner}};
const offer={id:'dd'.repeat(32),owner,stake:3000n,duration:512,reward:2000n,next:{id:zero,stake:0n,duration:0,reward:0n}};
const snapshot={config,clock:{height:200,hash:'ee'.repeat(32),mtp:1800001200},state:{head:offer,reserve:20000n},ordered:[offer],nodes:new Map(),vault:{},root:{}};
let live=true,rows:any[]=[],failure=false;
const wallet:WalletTransactions={publicKey:()=>owner,pairing:()=>({paired:true,live,identity:owner,network:'chipnet'}),restore:vi.fn(),v3:vi.fn(),queue:vi.fn(async()=>({intent:{kind:'insert'},stage:'pending',step:'action',raw:'retained',txid:'ff'.repeat(32)})),execute:vi.fn()};
beforeEach(()=>{localStorage.clear();rows=[];live=true;failure=false;vi.clearAllMocks();window.location.hash='#/v3/vault/'+genesis;vi.mocked(loadQueuePage).mockResolvedValue({network:'chipnet',vaults:[config],pages:[]});vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='list')return [];if(i.operation==='owned')return rows;if(failure)throw Error('Provider unavailable');return snapshot;});});
afterEach(cleanup);
async function open(){render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);await screen.findByRole('heading',{name:'Make an Offer'});}
it('validates 512-second units and preserves exact terms in the approval request',async()=>{await open();fireEvent.change(screen.getByLabelText('Lock duration (time units)'),{target:{value:'12'}});expect(screen.getAllByText(/1 hour, 42 minutes, 24 seconds/).length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'insert',config,terms:{stake:3000n,duration:6144,reward:2000n}}},expect.any(Function)));fireEvent.change(screen.getByLabelText('Lock duration (time units)'),{target:{value:'0'}});expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();});
it('binds a claim to the reviewed head, and waits for an offline saved pairing',async()=>{live=false;await open();const button=screen.getByRole('button',{name:'Claim reward'});expect(button).toBeEnabled();fireEvent.click(button);expect(wallet.queue).not.toHaveBeenCalled();await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());live=true;await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'claim',config,expectedHead:offer.id}},expect.any(Function)));});
it('cancels deferred approval when the terms or route change',async()=>{live=false;await open();fireEvent.click(screen.getByRole('button',{name:'Make an Offer'}));await waitFor(()=>expect(wallet.restore).toHaveBeenCalled());fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00004000'}});live=true;await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('changed or expired'));expect(wallet.queue).not.toHaveBeenCalled();});
it('shows owner states and enables matured withdrawal on the My Offers route',async()=>{window.location.hash='#/v3/my-offers';rows=[{id:offer.id,offer,status:'Baked',maturesAt:1800001000,checkedMtp:1800001200}];render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);const button=await screen.findByRole('button',{name:'Get my stake back'});expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(wallet.queue).toHaveBeenCalledWith({operation:'prepare',intent:{kind:'withdraw',config,offerId:offer.id}},expect.any(Function)));});
it('displays local/MTP release timing and the complete expandable schedule',async()=>{await open();expect(screen.getByText(/Blockchain time \(MTP\):/)).toBeInTheDocument();const summary=screen.getByText('Release schedule and history');await act(async()=>{fireEvent.click(summary);summary.closest('details')!.open=true;fireEvent(summary.closest('details')!,new Event('toggle'));});expect(screen.getByRole('columnheader',{name:'Scheduled local time'})).toBeInTheDocument();expect(screen.getAllByRole('row').length).toBeGreaterThan(10);});

it('shows atomic counts, exact reviewed fee/debit, and clears stale estimates',async()=>{await open();expect(screen.getByText('Transactions: 1 · Wallet approvals: 1')).toBeVisible();expect(screen.getByText(/Total stake committed:/)).toBeVisible();await act(async()=>{window.dispatchEvent(new CustomEvent('arena-queue-review',{detail:{intent:{kind:'insert'},plan:{fee:'3613'},walletDebit:'7813'}}));});expect(screen.getByText('Estimated network fee: 3613 sats')).toBeVisible();expect(screen.getByText(/Total wallet BCH committed, including fee: 7813 sats/)).toBeVisible();fireEvent.change(screen.getByLabelText('Stake amount'),{target:{value:'0.00004000'}});expect(screen.queryByText('Estimated network fee: 3613 sats')).not.toBeInTheDocument();});
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
it('uses raw token units without inventing decimals',async()=>{
 window.location.hash='#/create';render(<WalletTransactionsContext.Provider value={wallet}><QueueArena/></WalletTransactionsContext.Provider>);
 fireEvent.change(screen.getByLabelText('Reward asset'),{target:{value:'token'}});fireEvent.change(screen.getByLabelText('Reward token category'),{target:{value:'ab'.repeat(32)}});
 const field=screen.getByLabelText('Reward per release (min. 1 raw fungible unit)');fireEvent.change(field,{target:{value:'0.5'}});expect(screen.getByRole('alert',{name:'cap error'})).toHaveTextContent('token decimals are not assumed');
 fireEvent.change(field,{target:{value:'1'}});expect(screen.queryByRole('alert',{name:'cap error'})).toBeNull();expect(screen.getByRole('button',{name:'Create Vault'})).toBeEnabled();
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
