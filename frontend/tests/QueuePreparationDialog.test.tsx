import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {QueuePreparationDialog,confirmPreparation} from '../src/QueuePreparationDialog';
for(const count of [2,3])it('explains '+count+' approvals with exact costs and explicit continue/cancel',()=>{
 HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');});
 const respond=vi.fn(),quote={transactions:count,approvals:count,preparationFees:Array(count-1).fill('219'),creationFee:'504',totalFee:String(504+219*(count-1)),walletDebit:'42500',reserve:'40000',rewardCategory:'0'.repeat(64)};
 render(<QueuePreparationDialog request={{quote,respond}}/>);
 expect(screen.getByRole('heading',{name:count===2?'Additional wallet approval needed':'Additional wallet approvals needed'})).toBeVisible();
 expect(screen.getByText(count+' wallet approvals instead of 1')).toBeVisible();expect(screen.getByText((219*(count-1))+' satoshis')).toBeVisible();expect(screen.getByText(quote.totalFee+' satoshis')).toBeVisible();
 expect(screen.getByText(/self-send amount is not a fee/)).toBeVisible();expect(respond).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Continue with '+count+' approvals'}));expect(respond).toHaveBeenCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(respond).toHaveBeenCalledWith(false);
});
it('aborts a pending confirmation when the wallet/network authorization changes',async()=>{
 const control=new AbortController(),close=vi.fn();window.addEventListener('arena-preparation-close',close);
 const waiting=confirmPreparation({} as any,control.signal);control.abort();expect(await waiting).toBe(false);expect(close).toHaveBeenCalledOnce();window.removeEventListener('arena-preparation-close',close);
});
