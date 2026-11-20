vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',selectedNetwork:()=> 'chipnet',networkLeaving:false,switchNetwork:vi.fn()}));
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import App from '../src/App';
import { fixture } from './fixture';
import { REFRESH_MS } from '../src/useArena';
afterEach(()=>{vi.useRealTimers();window.history.replaceState(null,'','/');});
const response=(data:unknown)=>Promise.resolve(new Response(JSON.stringify(data),{status:200}));
function live(data=fixture()){vi.stubGlobal('fetch',vi.fn((input:string|URL)=>String(input).includes('bcmr.paytaca.com')||String(input).includes('bcmr-chipnet.paytaca.com')?
 response({token:{category:String(input).split('/').at(-2),symbol:'STAKE',decimals:2}}):response(data)));return render(<App/>);}
async function navigate(href:string){await act(async()=>{window.location.hash=href;window.dispatchEvent(new HashChangeEvent('hashchange'));});}
it('shows indexed vault terms with a v3 home link and no legacy navigation',async()=>{
 const fetcher=vi.fn(()=>response(fixture()));vi.stubGlobal('fetch',fetcher);render(<App/>);
 await screen.findByText('Maximum reward / period');
 expect(screen.getByRole('heading',{name:'Stake Arena'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Create Vault'})).toHaveAttribute('href','#/create');
 expect(screen.getByText('0.00001000 BCH')).toBeInTheDocument();
 expect(screen.getByText('Every minute')).toBeInTheDocument();
 expect(fetcher.mock.calls[0]).toBeDefined();
 expect(within(screen.getByRole('navigation')).getByRole('link',{name:'About'})).toHaveAttribute('href','#/about');
 expect(screen.getByRole('navigation')).not.toHaveTextContent('CHIPNET — TEST FUNDS ONLY');
 expect(screen.getByRole('link',{name:'Stake Arena home'})).toHaveAttribute('href','#/v3/offers');
 expect(screen.queryByText('Native BCH reserves')).not.toBeInTheDocument();
});
it('opens a dedicated hash detail route and ranks offers by exact priority',async()=>{
 const data=fixture();data.vaults[0].config.epoch=Math.floor(Date.now()/1000)+3600;window.location.hash='#/vault/'+data.vaults[0].category;live(data);
 const table=await screen.findByRole('table',{name:'Competing offers ranked by priority'});
 const rows=within(table).getAllByRole('row');
 expect(rows[1]).toHaveTextContent('Offer #01');expect(rows[2]).toHaveTextContent('Offer #00');
 expect(screen.getByText('Current period')).toBeInTheDocument();expect(screen.getByText('2 of 3')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Make an Offer'})).toHaveAttribute('href','#/vault/'+data.vaults[0].category+'/offer');
 expect(screen.getByText('Advanced vault information').closest('details')).not.toHaveAttribute('open');
});
it('keeps frozen snapshot competitors after a live cancellation',async()=>{
 const data=fixture(),v=data.vaults[0];v.phase='activated';v.snapshot=v.offers.map(o=>({...o}));v.offers[1].cancelled=true;
 window.location.hash='#/vault/'+v.category;live(data);
 const table=await screen.findByRole('table',{name:'Competing offers ranked by priority'});
 expect(within(table).getByText('Offer #01')).toBeInTheDocument();
 expect(screen.getByText('Frozen period roster')).toBeInTheDocument();
});
it('calculates the offer preview with exact BCH conversion and never submits a transaction',async()=>{
 const data=fixture();data.chain='chipnet';window.location.hash='#/vault/'+data.vaults[0].category+'/offer';live(data);
 await screen.findByRole('heading',{name:'Make an Offer'});await screen.findByText('Whole STAKE');
 for(const [name,value] of [[/^Stake amount/,'30'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const) fireEvent.change(screen.getByLabelText(name),{target:{value}});
 expect(screen.getByText('60 STAKE / 0.00001000 BCH')).toBeInTheDocument();expect(screen.getByText('90 STAKE')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/^Reward requested/),{target:{value:'0'}});
 expect(screen.getByText(/Requested reward must be at least/)).toBeInTheDocument();
 expect(screen.getByText('Chipnet test funds only')).toBeInTheDocument();
});
it('offers both asset choices offline with exact BCH funding and no authorization',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));window.location.hash='#/create';render(<App/>);
 await screen.findByRole('heading',{name:'Create Vault'});
 expect(screen.getAllByRole('option')).toHaveLength(8);expect(screen.getByRole('combobox',{name:'Reward asset'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/^Staking asset category/),{target:{value:'e'.repeat(64)}});
 fireEvent.change(screen.getByRole('textbox',{name:/^Maximum reward/}),{target:{value:'0.00001000'}});
 fireEvent.change(screen.getByRole('textbox',{name:/^Number of periods/}),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText(/^Schedule starts/),{target:{value:'2027-01-01T00:00'}});
 expect(screen.getByText('0.00003000 BCH')).toBeInTheDocument();
 expect(screen.getByText(/No staking asset deposit is required/)).toBeInTheDocument();
});
it('handles loading, empty data, missing vaults and initial outages without fabricated listings',async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));const loading=render(<App/>);expect(screen.getByText('Loading vaults…')).toBeInTheDocument();loading.unmount();
 const empty=live({...fixture(),vaults:[]});await screen.findByText('No vaults listed');empty.unmount();localStorage.clear();
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('offline')));const offline=render(<App/>);await screen.findByText('Vault data unavailable');expect(screen.queryByText('Maximum reward / period')).not.toBeInTheDocument();offline.unmount();
 live();await navigate('/vault/'+'1'.repeat(64));await screen.findByText('Vault not found');
 await navigate('/invalid');expect(screen.getByText('Page not found')).toBeInTheDocument();
});
it('retains historical terms on polling failure, labels a restored snapshot and recovers',async()=>{
 vi.useFakeTimers();const data=fixture();
 vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>response(data)).mockRejectedValue(Error('offline')));
 const first=render(<App/>);await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(REFRESH_MS);});
 expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');expect(screen.getByText('Expired — awaiting on-chain processing · at snapshot')).toBeInTheDocument();first.unmount();vi.useRealTimers();
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));const restored=render(<App/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Saved indexed snapshot');expect(screen.getByText('Last-known indexed snapshot · not current')).toBeInTheDocument();
 await navigate('/vault/'+data.vaults[0].category);expect(screen.getByText('Period at snapshot')).toBeInTheDocument();restored.unmount();
 vi.stubGlobal('fetch',vi.fn(()=>response(fixture())));render(<App/>);await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
it('shows stale and malformed API responses without claiming current status',async()=>{
 const data=fixture();data.health.connected=false;live(data);
 await screen.findByText('Expired — awaiting on-chain processing · at snapshot');expect(screen.getByRole('alert')).toHaveTextContent('not synchronized');
 vi.stubGlobal('fetch',vi.fn(()=>response({chain:'main'})));fireEvent.click(screen.getByRole('button',{name:'Refresh data'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('incompatible or malformed'));
});
it('does not declare a vault absent while the snapshot is stale or indexing has failed',async()=>{
 const data=fixture();data.health.connected=false;data.health.stale=true;
 window.location.hash='#/vault/'+'9'.repeat(64);live(data);
 await screen.findByText('Vault data unavailable');expect(screen.queryByText('Vault not found')).not.toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('not synchronized');
});

it('resolves the confirmed genesis ID as an alias without confusing it with the vault category',async()=>{
 const data=fixture();data.vaults[0].config.epoch=Math.floor(Date.now()/1000)+3600;window.location.hash='#/vault/'+data.vaults[0].config.genesis;live(data);
 await screen.findByRole('table',{name:'Competing offers ranked by priority'});
 expect(screen.getByRole('link',{name:'Make an Offer'})).toHaveAttribute('href','#/vault/'+data.vaults[0].category+'/offer');
 expect(screen.queryByText('Vault not found')).not.toBeInTheDocument();
});

it('opens About directly with the shared top navigation and wallet controls',()=>{
 const fetcher=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);
 window.location.hash='#/about';render(<App/>);
 expect(screen.getByRole('heading',{name:'Stake Arena'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'How It Works'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Core Use Cases'})).toBeInTheDocument();
 expect(screen.getByText('PvP staking protocol').tagName).toBe('EM');
 expect(screen.getByRole('link',{name:'← Back to marketplace'})).toHaveAttribute('href','#/v3/offers');
 expect(screen.getByRole('button',{name:/connect wallet/i})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Network'})).toBeInTheDocument();
 expect(fetcher).not.toHaveBeenCalled();
});

it('navigates to About and back to the existing marketplace views',async()=>{
 live();await screen.findByText('Maximum reward / period');
 await navigate('/about');
 expect(screen.getByRole('heading',{name:'How It Works'})).toBeInTheDocument();
 expect(screen.queryByText('Maximum reward / period')).not.toBeInTheDocument();
 await navigate('/');await screen.findByText('Maximum reward / period');
});
