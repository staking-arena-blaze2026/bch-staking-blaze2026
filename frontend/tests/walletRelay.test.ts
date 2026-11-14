import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createWalletRelay} from '../src/walletRelay';
import {RelayClient,RelayMsgAction} from '@wizardconnect/core';
vi.mock('@wizardconnect/core',async importOriginal=>{
 const original=await importOriginal<typeof import('@wizardconnect/core')>();
 return {...original,RelayClient:vi.fn(class extends EventEmitter {
   live=false;
   connect=vi.fn(async()=>{this.live=true;this.emit('connection');});
   disconnect=vi.fn(async()=>{this.live=false;this.emit('disconnect');});
   isConnected=()=>this.live;
   getPublicKeyHex=()=> '03'.repeat(32);
   setPairedPublicKey=vi.fn();
 })};
});
afterEach(()=>vi.useRealTimers());
it('serializes failed connection attempts with backoff and permanently stops after cleanup',async()=>{
 vi.useFakeTimers();const callback=vi.fn();const relay=createWalletRelay(callback);
 const client=relay.client;
 vi.mocked(client.connect).mockImplementation(async()=>{client.emit('error',Error('synthetic failure'));throw Error('offline');});
 await vi.advanceTimersByTimeAsync(0);expect(client.connect).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1999);expect(client.connect).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(client.connect).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(6000);expect(client.connect).toHaveBeenCalledTimes(3);
 relay.cleanup();await vi.advanceTimersByTimeAsync(600_000);
 expect(client.connect).toHaveBeenCalledTimes(3);expect(client.disconnect).toHaveBeenCalledOnce();
 expect(client.listenerCount('error')).toBe(0);
});
it('reuses exactly the saved peer and session credentials without generating a new pairing',async()=>{
 vi.useFakeTimers();const saved={privateKey:'01'.repeat(32),secret:'aa'.repeat(8),walletPublicKey:'02'.repeat(32)};
 const callback=vi.fn(),relay=createWalletRelay(callback,{existingCredentials:saved});
 expect(RelayClient).toHaveBeenLastCalledWith(expect.objectContaining({pairedPublicKey:new Uint8Array(32).fill(2),signerPrivateKey:new Uint8Array(32).fill(1)}));
 expect(relay.credentials).toMatchObject({privateKey:saved.privateKey,secret:saved.secret});
 await vi.advanceTimersByTimeAsync(0);
 relay.client.emit('message',{action:RelayMsgAction.WalletReady,public_key:'04'.repeat(32)});
 expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({status:expect.objectContaining({status:'session_deleted'})}));
 relay.cleanup();
});
it('rejects malformed saved credentials before opening a relay',()=>{
 expect(()=>createWalletRelay(vi.fn(),{existingCredentials:{privateKey:'bad',walletPublicKey:'bad',secret:'bad'}})).toThrow('Invalid saved transport credentials');
});

it('cancels a scheduled reconnect when the existing transport recovers first',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());
 await vi.advanceTimersByTimeAsync(0);
 relay.client.emit('disconnect');relay.client.emit('connection');
 await vi.advanceTimersByTimeAsync(30_000);
 expect(relay.client.connect).toHaveBeenCalledOnce();relay.cleanup();
});

it('does not overlap a still-pending connection call after its event deadline',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());
 let finish!:()=>void;
 vi.mocked(relay.client.connect).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await vi.advanceTimersByTimeAsync(30_000);
 expect(relay.client.connect).toHaveBeenCalledOnce();
 relay.cleanup();finish();await vi.advanceTimersByTimeAsync(60_000);
 expect(relay.client.connect).toHaveBeenCalledOnce();
});
