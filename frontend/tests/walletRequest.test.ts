import {afterEach,expect,it,vi} from 'vitest';
import {restoreWalletRequest,WALLET_REQUEST_MS} from '../src/walletRequest';
import type {WalletTransactions} from '../src/walletTransactions';
afterEach(()=>vi.useRealTimers());
function setup(){
 vi.useFakeTimers();
 const status={paired:true,live:false,identity:'authenticated-wallet',network:'mainnet',generation:0};
 const wallet:WalletTransactions={pairing:()=>({...status}),restore:vi.fn(),publicKey:()=>'',execute:vi.fn(),v3:vi.fn(),v3Availability:()=>({available:status.live})};
 let current:WalletTransactions|null=wallet,valid=true;
 const abort=new AbortController(),waiting=vi.fn();
 const start=()=>restoreWalletRequest(()=>current,()=>valid,abort.signal,waiting);
 return {status,wallet,abort,waiting,start,replace:(w:WalletTransactions|null)=>{current=w;},edit:()=>{valid=false;}};
}
it('waits without preparing or signing, then uses the freshly restored client exactly once',async()=>{
 const t=setup(),pending=t.start();expect(t.waiting).toHaveBeenCalledOnce();expect(t.wallet.restore).toHaveBeenCalledOnce();expect(t.wallet.v3).not.toHaveBeenCalled();
 const fresh={...t.wallet,v3:vi.fn()};t.replace(fresh);t.status.live=true;
 await vi.advanceTimersByTimeAsync(100);const result=await pending;expect(result.wallet).toBe(fresh);expect(result.check).not.toThrow();
});
it('requires live authorization even with an online pairing hint',async()=>{
 const t=setup();t.status.live=true;t.wallet.v3Availability=()=>({available:false,reason:'Wrong wallet network'});
 await expect(t.start()).rejects.toThrow('Wrong wallet network');expect(t.wallet.v3).not.toHaveBeenCalled();
});
it.each(['timeout','disconnect','identity','repaired-same-wallet','network','edited','unmount','client-removed'])('cancels %s requests and never resumes them later',async cause=>{
 const t=setup();const pending=t.start();const rejected=expect(pending).rejects.toThrow(/Review the current terms|connection timed out/);
 if(cause==='timeout')await vi.advanceTimersByTimeAsync(WALLET_REQUEST_MS);
 if(cause==='disconnect')t.status.paired=false;
 if(cause==='identity')t.status.identity='other-wallet';
 if(cause==='repaired-same-wallet')t.status.generation++;
 if(cause==='network')t.status.network='chipnet';
 if(cause==='edited')t.edit();
 if(cause==='unmount')t.abort.abort();
 if(cause==='client-removed')t.replace(null);
 await vi.advanceTimersByTimeAsync(100);await rejected;
 t.status.live=true;await vi.advanceTimersByTimeAsync(1000);expect(t.wallet.v3).not.toHaveBeenCalled();
});
it.each(['verification','popup review'])('keeps unchanged intent valid after >90 seconds of %s',async()=>{
 const t=setup();t.status.live=true;const request=await t.start();await vi.advanceTimersByTimeAsync(WALLET_REQUEST_MS*3);
 expect(request.check).not.toThrow();
});
it.each(['offline','reconnect','identity','network','edit','abort'])('invalidates restored intent on %s',async cause=>{
 const t=setup();t.status.live=true;const request=await t.start();
 if(cause==='offline')t.status.live=false;
 if(cause==='reconnect')t.status.generation++;
 if(cause==='identity')t.status.identity='new';
 if(cause==='network')t.status.network='chipnet';
 if(cause==='edit')t.edit();
 if(cause==='abort')t.abort.abort();
 expect(request.check).toThrow('request changed');
});
it('saved hints without a pairing cannot queue a transaction',async()=>{
 const t=setup();t.status.paired=false;await expect(t.start()).rejects.toThrow('Connect Wallet');expect(t.wallet.restore).not.toHaveBeenCalled();
});
it('a backwards wall-clock adjustment cannot extend restoration',async()=>{
 const t=setup();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 const pending=t.start(),rejected=expect(pending).rejects.toThrow('connection timed out');
 vi.setSystemTime(Date.now()-3600000);elapsed=WALLET_REQUEST_MS;
 await vi.advanceTimersByTimeAsync(100);await rejected;
});
