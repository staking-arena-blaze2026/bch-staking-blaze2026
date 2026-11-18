import {EventEmitter} from 'node:events';
import {expect,it} from 'vitest';
import {ExplicitWalletRefusal,signWithRefusalEvidence} from '../src/walletSigning';
it('authenticated matching refusal releases funds; thrown error text alone cannot',async()=>{
 const manager=Object.assign(new EventEmitter(),{signTransaction:async()=>{manager.emit('messagesent',{action:'sign_transaction_request',sequence:3});manager.emit('messagereceived',{action:'sign_transaction_response',sequence:3,error:'User rejected the transaction'});throw Error('User rejected');}});
 await expect(signWithRefusalEvidence(manager as any,{} as any,{})).rejects.toBeInstanceOf(ExplicitWalletRefusal);
 manager.signTransaction=async()=>{throw Error('User rejected or transport timed out');};await expect(signWithRefusalEvidence(manager as any,{} as any,{})).rejects.not.toBeInstanceOf(ExplicitWalletRefusal);
 expect(manager.listenerCount('messagesent')).toBe(0);expect(manager.listenerCount('messagereceived')).toBe(0);
});
it('unrelated response sequence never releases an uncertain request',async()=>{
 const manager=Object.assign(new EventEmitter(),{signTransaction:async()=>{manager.emit('messagesent',{action:'sign_transaction_request',sequence:3});manager.emit('messagereceived',{action:'sign_transaction_response',sequence:2,error:'User rejected the transaction'});throw Error('Connection lost');}});
 await expect(signWithRefusalEvidence(manager as any,{} as any,{})).rejects.not.toBeInstanceOf(ExplicitWalletRefusal);
});

it('retains a matching authenticated response delivered after the SDK cancelled its promise',async()=>{
 const {vi}=await import('vitest'),retain=vi.fn(async()=>{});
 const manager=Object.assign(new EventEmitter(),{signTransaction:async()=>{manager.emit('messagesent',{action:'sign_transaction_request',sequence:7});throw new DOMException('Session interrupted','AbortError');}});
 await expect(signWithRefusalEvidence(manager as any,{} as any,{},retain)).rejects.toThrow('Session interrupted');
 manager.emit('messagereceived',{action:'sign_transaction_response',sequence:6,signedTransaction:'unrelated'});expect(retain).not.toHaveBeenCalled();
 manager.emit('messagereceived',{action:'sign_transaction_response',sequence:7,signedTransaction:'signed bytes'});
 await Promise.resolve();expect(retain).toHaveBeenCalledExactlyOnceWith('signed bytes');expect(manager.listenerCount('messagereceived')).toBe(0);
 manager.emit('messagereceived',{action:'sign_transaction_response',sequence:7,signedTransaction:'signed bytes'});expect(retain).toHaveBeenCalledOnce();
});
it('does not drop evidence when a signature event races SDK rejection',async()=>{
 const {vi}=await import('vitest'),retain=vi.fn(async()=>{});
 const manager=Object.assign(new EventEmitter(),{signTransaction:async()=>{manager.emit('messagesent',{action:'sign_transaction_request',sequence:9});manager.emit('messagereceived',{action:'sign_transaction_response',sequence:9,signedTransaction:'racing bytes'});throw Error('Connection lost');}});
 await expect(signWithRefusalEvidence(manager as any,{} as any,{},retain)).rejects.toThrow('Connection lost');await Promise.resolve();expect(retain).toHaveBeenCalledExactlyOnceWith('racing bytes');
});
