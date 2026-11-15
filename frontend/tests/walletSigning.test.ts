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
