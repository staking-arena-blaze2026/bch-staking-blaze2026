import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import GeneralizedVaults,{saveV2Config,readV2Configs} from '../src/GeneralizedVaults';
import GeneralizedAssets from '../src/GeneralizedAssets';
import {WalletTransactionsContext,type WalletTransactions} from '../src/walletTransactions';
import type {Operation} from '../../src/v2/wallet';
const config={version:2 as const,genesis:'c'.repeat(64),stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'token' as const,category:'ab'.repeat(32)},cap:7n,periods:3,periodSeconds:60,epoch:1800000000};
it('retains exact imported v2 asset terms and labels saved discovery as historical',()=>{
 saveV2Config(config);expect(readV2Configs()[0]).toEqual(config);render(<GeneralizedVaults/>);
 expect(screen.getByRole('link',{name:/V2 vault cccc/})).toHaveAttribute('href','#/v2/vault/'+config.genesis);
 expect(screen.getByText(/Staking: BCH. Reward: CashToken ab/)).toHaveTextContent('7 raw units of CashToken');
 expect(screen.getByText(/Saved discovery hint/)).toBeInTheDocument();
});
it('shows pending v2 genesis from existing recovery journals without inventing confirmation',async()=>{
 const v2=vi.fn(async()=>[{kind:'create',step:'action',stage:'pending',parameters:config,txid:config.genesis} as unknown as Operation]);
 const wallet={v2,execute:vi.fn(),publicKey:()=>''} as WalletTransactions;
 render(<WalletTransactionsContext.Provider value={wallet}><GeneralizedVaults/></WalletTransactionsContext.Provider>);
 expect(await screen.findByText(/Pending \/ Unconfirmed \(0-conf\)/)).toHaveTextContent('recovery record');expect(v2).toHaveBeenCalledWith({operation:'list'});
});
it('loads a saved v2 detail configuration without requesting any signature or network verification automatically',async()=>{
 saveV2Config(config);render(<GeneralizedAssets genesis={config.genesis}/>);
 expect(screen.getByRole('button',{name:'Verify and refresh vault'})).toBeDisabled();
 expect(screen.getByRole('heading',{name:'Open a v2 vault'})).toBeInTheDocument();
 expect((screen.getByLabelText('V2 vault configuration') as HTMLTextAreaElement).value).toContain(config.genesis);
});
