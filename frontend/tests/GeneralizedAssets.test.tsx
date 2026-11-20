import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import GeneralizedAssets from '../src/GeneralizedAssets';
it('directs legacy v2 creation links to the unified Create Vault form and retains recovery',()=>{
 render(<GeneralizedAssets/>);
 expect(screen.getByRole('link',{name:/Create Vault/})).toHaveAttribute('href','#/create');
 expect(screen.queryByLabelText('Reward asset')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Recoverable v2 operations'})).toBeInTheDocument();
});

import {act,fireEvent} from '@testing-library/react';
import {vi} from 'vitest';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
import {saveV2Config} from '../src/GeneralizedVaults';
it('verifies actual BCH/token terms and converts BCH offers to exact raw units with recovery intact',async()=>{
 const config={version:2 as const,genesis:'c'.repeat(64),stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'token' as const,category:'ab'.repeat(32)},cap:7n,periods:3,periodSeconds:60,epoch:1800000000};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({token:{category:config.rewardAsset.category,symbol:'ALT',decimals:0}}))));
 const v2=vi.fn(async(intent:Record<string,unknown>)=>intent.operation==='list'?[]:intent.operation==='sync'?{config,instance:{state:new Uint8Array(1580),parameters:config,inputs:[{satoshis:1000n},{satoshis:1000n},{satoshis:1000n,token:{amount:21n}}]},pending:[],allocations:[],clock:{mtp:1790000000}}:{stage:'pending',step:'funding'});
 const wallet={v2,execute:vi.fn(),publicKey:()=>''} as WalletTransactions;
 saveV2Config(config);render(<WalletTransactionsContext.Provider value={wallet}><GeneralizedAssets genesis={config.genesis}/></WalletTransactionsContext.Provider>);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Verify and refresh vault'})));
 expect(screen.getAllByText(/Maximum reward: 7 ALT per period/)[1]).toHaveTextContent('Staking: BCH. Reward: ALT');
 expect(screen.getByText(/Protected staking escrow:/)).toHaveTextContent('0.00000000 BCH');
 fireEvent.change(screen.getByLabelText('Stake S (BCH)'),{target:{value:'0.00003001'}});
 fireEvent.change(screen.getByLabelText('Requested reward R (ALT)'),{target:{value:'7'}});
 expect(screen.getByText(/Required upfront stake:/)).toHaveTextContent('Exact priority: 0.00006002 BCH / 7 ALT');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Review offer funding in wallet'})));
 expect(v2).toHaveBeenCalledWith(expect.objectContaining({operation:'offer',config,terms:{stake:3001n,duration:2,reward:7n,maxWins:3}}));
});
