// Reproduce the original dependency behavior with its real React hook/manager,
// replacing only the transport. These assertions record the defect, not our fix.
import {StrictMode,useEffect} from 'react';
import {render,act} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {useWizardConnect} from '@wizardconnect/react';
import {initiateDappRelay} from '@wizardconnect/core';
vi.mock('@wizardconnect/core',async original=>({...await original<typeof import('@wizardconnect/core')>(),initiateDappRelay:vi.fn()}));
it('reproduces duplicate restoration and automatic deletion on remote disconnect in the original SDK hook',async()=>{
 const client=Object.assign(new EventEmitter(),{isKeyExchangeComplete:()=>true,relay:async()=>{}});
 const cleanup=vi.fn();
 vi.mocked(initiateDappRelay).mockImplementation(()=>({client,events:new EventEmitter(),credentials:{privateKey:'synthetic',secret:'synthetic'},cleanup}) as any);
 localStorage.setItem('staking-arena-wizardconnect-v1',JSON.stringify({privateKey:'synthetic',secret:'synthetic',walletPublicKey:'02'}));
 let latest:ReturnType<typeof useWizardConnect>;
 function Original(){
   const wallet=useWizardConnect({sessionKey:'staking-arena-wizardconnect-v1'});latest=wallet;
   const active=['connected','connecting','reconnecting'].includes(wallet.state);
   useEffect(()=>{const manager=wallet.manager;if(!active)manager?.destroy();return()=>manager?.destroy();},[wallet.manager,active]);
   return null;
 }
 const view=render(<StrictMode><Original/></StrictMode>);
 expect(initiateDappRelay).toHaveBeenCalledTimes(2);
 expect(cleanup).toHaveBeenCalledOnce();
 await act(async()=>{latest!.manager!.emit('disconnect','user_disconnect' as any,undefined);});
 expect(localStorage.getItem('staking-arena-wizardconnect-v1')).toBeNull();
 view.unmount();
});
