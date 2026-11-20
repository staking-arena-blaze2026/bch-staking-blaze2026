import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {BrowserCreateForm,BrowserOfferForm} from '../src/BrowserWalletForms';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
import {fixture} from './fixture';
const asset='a'.repeat(64),client=():WalletTransactions=>({browser:true,publicKey:()=> '03b8862eaed4d4fba715b9b0b8cb0ccefea32841fcbcf847be960e34545de1fd25',inventory:vi.fn(async()=>({coins:[],bch:'200000',tokens:{[asset]:'5000'},addresses:63,gap:20,limit:40,bounded:true as const})),operations:async()=>[],execute:vi.fn(async()=>({txid:'b'.repeat(64),status:'pending'}))});
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async (input:string)=>{
 const category=input.split('/').at(-2);
 return new Response(JSON.stringify({token:{category,decimals:2,symbol:category===asset?'TOK':'ALT'}}));
})));
const fill=(label:RegExp|string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
it('requires explicit funding review and approval; shows exact lifecycle quote without a backend',async()=>{
 const wallet=client(),fetcher=vi.mocked(globalThis.fetch);render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 fill('Protocol version','1');fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Period duration/,'60');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2026-11-12T00:00');
 expect(screen.getByText('0.00082000 BCH (82000 satoshis)')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'}));});expect(wallet.execute).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review funding in wallet'}));});expect(wallet.execute).toHaveBeenCalledWith(expect.objectContaining({kind:'create',parameters:expect.objectContaining({cap:2000,periods:2})}));expect(fetcher.mock.calls.every(([url])=>String(url).includes('bcmr-chipnet.paytaca.com'))).toBe(true);
});
it('reviews S×W deposit, refuses invalid/closed offers and displays wallet rejection without retry signing',async()=>{
 const wallet=client();vi.mocked(wallet.execute).mockRejectedValue(Error('Wallet rejected signing'));
 const vault={...fixture().vaults[0],config:{...fixture().vaults[0].config,epoch:Math.floor(Date.now()/1000)+3600,stakingCategory:asset,periods:2,cap:2000},offers:[]};
 const mounted=render(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={vault} tip={{...fixture().tip!,mtp:Math.floor(Date.now()/1000)}} stale={false}/></WalletTransactionsContext.Provider>);
 fill(/^Stake amount S/,'10');fill('Lock duration T','1');fill('Reward requested R (BCH)','0.00003000');fill('Maximum wins W','2');await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'}));});fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();
 fill('Reward requested R (BCH)','0.00001000');expect(await screen.findByText('20 TOK',{selector:'dd'})).toBeInTheDocument();
 const inventory=await wallet.inventory!();
 vi.mocked(wallet.inventory!).mockResolvedValueOnce({...inventory,tokens:{[asset]:'1999'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();
 expect(screen.getByRole('alert')).toHaveTextContent('19.99 TOK');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review offer funding in wallet'}));});await screen.findByText('Error: Wallet rejected signing');expect(wallet.execute).toHaveBeenCalledWith(expect.objectContaining({terms:{stake:1000,duration:1,reward:1000,maxWins:2}}));
 mounted.rerender(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={{...vault,phase:'activated'}} tip={{...fixture().tip!,mtp:Math.floor(Date.now()/1000)}} stale={false}/></WalletTransactionsContext.Provider>);expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Registration is unavailable');
});
it('ignores a superseded worker startup error when the live wallet client replaces it',async()=>{
 let rejectOld!:(error:Error)=>void;
 const old=client();old.operations=()=>new Promise((_resolve,reject)=>{rejectOld=reject;});
 const mounted=render(<WalletTransactionsContext.Provider value={old}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 mounted.rerender(<WalletTransactionsContext.Provider value={client()}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 await act(async()=>{rejectOld(Error('Wallet worker closed'));});
 expect(screen.queryByText(/Wallet worker closed/)).not.toBeInTheDocument();
});
it('clears a verified balance on failed refresh, displays retry progress, and enables funding only after recovery',async()=>{
 const wallet=client();render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 fill('Protocol version','1');fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Period duration/,'60');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2026-11-12T00:00');
 const review=screen.getByRole('button',{name:'Review funding in wallet'}),scan=screen.getByRole('button',{name:'Check wallet balances'});
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));expect(review).toBeEnabled();
 let rejectScan!:(error:Error)=>void;vi.mocked(wallet.inventory!).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectScan=reject;}));
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeDisabled();
 act(()=>window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Normal new block; retrying both providers (2/3)'})));
 expect(screen.getByText(/retrying both providers/)).toBeInTheDocument();
 await act(async()=>rejectScan(Error('Wallet balances could not be verified after 3 attempts. Check wallet balances again.')));
 expect(review).toBeDisabled();expect(screen.getByText(/could not be verified after 3 attempts/)).toBeInTheDocument();
 await act(async()=>{fireEvent.click(scan);});expect(review).toBeEnabled();expect(wallet.execute).not.toHaveBeenCalled();
});

it('disables offer submission for an overdue or expired UTC schedule even while chain MTP lags',async()=>{
 const wallet=client(),epoch=Math.floor(Date.now()/1000)-600;
 const vault={...fixture().vaults[0],period:0,phase:'open' as const,config:{...fixture().vaults[0].config,epoch,periodSeconds:300,periods:2},offers:[]};
 render(<WalletTransactionsContext.Provider value={wallet}><BrowserOfferForm vault={vault} tip={{...fixture().tip!,mtp:epoch-1}} stale={false}/></WalletTransactionsContext.Provider>);
 expect(screen.getByRole('button',{name:'Review offer funding in wallet'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('scheduled cutoff');expect(wallet.execute).not.toHaveBeenCalled();
});

it('uses verified category suggestions, preserves manual entry, hides BCH categories and requires verified funding before public v2 approval',async()=>{
 const wallet=client();wallet.v2=vi.fn(async(intent)=>intent.operation==='list'?[]:{id:'new-v2',kind:'create',step:'funding',stage:'pending',parameters:intent.parameters,txid:'c'.repeat(64)});render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 expect(document.querySelector('datalist option')).toHaveValue(asset);
 fill('Protocol version','1');fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2027-01-01T00:00');
 fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeEnabled();
 fill('Staking asset','bch');expect(screen.queryByLabelText(/^Staking asset category/)).not.toBeInTheDocument();expect(screen.getByRole('checkbox')).not.toBeChecked();
 expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 fill('Reward asset','token');expect(screen.getByLabelText(/^Maximum reward per period/)).toHaveValue('');
 fill(/^Reward token category/,'b'.repeat(64));fill(/^Maximum reward per period/,'7');
 expect(await screen.findByText('14 ALT',{selector:'dd'})).toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Insufficient reward CashTokens');
 fill(/^Reward token category/,asset);await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeEnabled();expect(wallet.execute).not.toHaveBeenCalled();expect(wallet.v2).toHaveBeenCalledWith({operation:'list'});
 fill('Staking asset','token');expect(screen.getByLabelText(/^Staking asset category/)).toHaveValue(asset);
 fill('Reward asset','bch');expect(screen.queryByLabelText(/^Reward token category/)).not.toBeInTheDocument();expect(screen.getByLabelText(/^Maximum reward per period/)).toHaveValue('');
});
it('refuses insufficient funding or missing category proof without requiring a staking deposit',async()=>{
 const wallet=client();vi.mocked(wallet.inventory!).mockResolvedValue({coins:[],bch:'1000',tokens:{},addresses:1,gap:20,limit:40,bounded:true});
 render(<WalletTransactionsContext.Provider value={wallet}><BrowserCreateForm/></WalletTransactionsContext.Provider>);
 fill('Protocol version','1');fill(/^Staking asset category/,asset);fill(/^Maximum reward per period/,'0.00002000');fill(/^Number of periods/,'2');fill(/^Schedule starts/,'2027-01-01T00:00');fireEvent.click(screen.getByRole('checkbox'));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 expect(screen.getByRole('alert')).toHaveTextContent('Insufficient token-free BCH');expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 vi.mocked(wallet.inventory!).mockResolvedValue({coins:[],bch:'200000',tokens:{},addresses:1,gap:20,limit:40,bounded:true});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Tokens are verified, not deposited');
 vi.mocked(wallet.inventory!).mockResolvedValue({coins:[],bch:'200000',tokens:{[asset]:'1'},addresses:1,gap:20,limit:40,bounded:true});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Check wallet balances'})));
 expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeEnabled();
 fill(/^Staking asset category/,'0'.repeat(64));expect(screen.getByText('Invalid fungible asset category')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
});
it('preserves legacy API creation recovery records in the unified form',()=>{
 const record={stakingCategory:asset,cap:2000,periods:2,periodSeconds:60,epoch:1800000000,genesis:'b'.repeat(64)};
 localStorage.setItem('staking-arena-pending-chipnet-genesis',JSON.stringify(record));
 render(<BrowserCreateForm/>);
 expect(screen.getByText('Existing API creation recovery')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Admit confirmed genesis'})).toBeInTheDocument();
 expect(JSON.parse(localStorage.getItem('staking-arena-pending-chipnet-genesis')!)).toEqual(record);
});
