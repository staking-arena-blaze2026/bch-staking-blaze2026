import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {createWalletRelay} from '../src/walletRelay';
import {RelayClient,RelayMsgAction} from '@wizardconnect/core';
vi.mock('@wizardconnect/core',async importOriginal=>{
 const original=await importOriginal<typeof import('@wizardconnect/core')>();
 return {...original,RelayClient:vi.fn(class extends EventEmitter {
   live=false;
   relay=vi.fn(async()=>{});
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
 await vi.advanceTimersByTimeAsync(4000);expect(client.connect).toHaveBeenCalledTimes(3);
 relay.cleanup();await vi.advanceTimersByTimeAsync(600_000);
 expect(client.connect).toHaveBeenCalledTimes(3);expect(client.disconnect).toHaveBeenCalledTimes(4);
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

it('keeps trying long outages with capped backoff and recovers on availability',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());
 vi.mocked(relay.client.connect).mockRejectedValue(Error('offline'));
 await vi.advanceTimersByTimeAsync(300_000);
 const count=vi.mocked(relay.client.connect).mock.calls.length;
 expect(count).toBeGreaterThan(4);expect(count).toBeLessThan(16);
 vi.mocked(relay.client.connect).mockImplementation(async()=>{relay.client.emit('connection');});
 relay.recover?.();await vi.advanceTimersByTimeAsync(0);
 expect(relay.transportReachable?.()).toBe(true);
 relay.cleanup();
});

it('coalesces overlapping handshake publications but allows a later fresh attempt',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());
 // The wrapper calls the original relay mock; defer it before creation next time.
 relay.cleanup();
 const send=vi.fn<(...args:unknown[])=>Promise<void>>();let finish!:()=>void;
 send.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 vi.mocked(RelayClient).mockImplementationOnce(class extends EventEmitter {
  relay=send;connect=vi.fn(async()=>{});disconnect=vi.fn(async()=>{});
  getPublicKeyHex=()=> '03'.repeat(32);
 } as unknown as typeof RelayClient);
 const next=createWalletRelay(vi.fn());
 const message={action:RelayMsgAction.DappReady,time:1,supported_protocols:[],wallet_discovered:false};
 const a=next.client.relay(message);
 const b=next.client.relay(message);
 expect(a).toBe(b);expect(send).toHaveBeenCalledOnce();finish();await a;await Promise.resolve();
 void next.client.relay(message);expect(send).toHaveBeenCalledTimes(2);
 finish();next.cleanup();
});

it('serializes the reactive protocol confirmation after a pending proactive ready',async()=>{
 vi.useFakeTimers();let finish!:()=>void;
 const send=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 vi.mocked(RelayClient).mockImplementationOnce(class extends EventEmitter {
  relay=send;connect=vi.fn(async()=>{});disconnect=vi.fn(async()=>{});
  getPublicKeyHex=()=> '03'.repeat(32);
 } as unknown as typeof RelayClient);
 const relay=createWalletRelay(vi.fn());
 const proactive={action:RelayMsgAction.DappReady,time:1,wallet_discovered:false};
 const reactive={...proactive,wallet_discovered:true,selected_protocol:'hdwalletv1'};
 const a=relay.client.relay(proactive),b=relay.client.relay(reactive);
 expect(a).not.toBe(b);expect(send).toHaveBeenCalledOnce();
 finish();await a;await Promise.resolve();await Promise.resolve();
 expect(send).toHaveBeenCalledTimes(2);finish();await b;relay.cleanup();
});

it('requests fresh readiness when the SDK retains discovered state after transport recovery',async()=>{
 vi.useFakeTimers();const send=vi.fn(async()=>{});
 vi.mocked(RelayClient).mockImplementationOnce(class extends EventEmitter {
  relay=send;connect=vi.fn(async()=>{});disconnect=vi.fn(async()=>{});
  getPublicKeyHex=()=> '03'.repeat(32);
 } as unknown as typeof RelayClient);
 const relay=createWalletRelay(vi.fn());
 relay.prepareHandshake?.();
 const message={action:RelayMsgAction.DappReady,time:1,wallet_discovered:true,selected_protocol:'hdwalletv1'};
 await relay.client.relay(message);
 expect(send).toHaveBeenLastCalledWith({action:RelayMsgAction.DappReady,time:1,wallet_discovered:false});
 await relay.client.relay(message);
 expect(send).toHaveBeenLastCalledWith(message);relay.cleanup();
});

it('refreshes a ready-but-silent subscription with bounded timing and stops on a wallet reply',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());
 await vi.advanceTimersByTimeAsync(0);
 relay.prepareHandshake?.();
 await vi.advanceTimersByTimeAsync(14_999);expect(relay.client.connect).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(1);expect(relay.client.connect).toHaveBeenCalledTimes(2);
 relay.prepareHandshake?.();
 await vi.advanceTimersByTimeAsync(29_999);expect(relay.client.connect).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1);expect(relay.client.connect).toHaveBeenCalledTimes(3);
 relay.prepareHandshake?.();
 relay.client.emit('message',{action:RelayMsgAction.WalletReady,secret:relay.credentials.secret,public_key:'02'.repeat(32)});
 await vi.advanceTimersByTimeAsync(120_000);expect(relay.client.connect).toHaveBeenCalledTimes(3);
 relay.cleanup();
});

it('manual recovery refreshes even a nominally ready subscription and coalesces repeated clicks',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());await vi.advanceTimersByTimeAsync(0);
 relay.recover?.();await vi.advanceTimersByTimeAsync(0);expect(relay.client.connect).toHaveBeenCalledOnce();
 relay.recover?.(true);relay.recover?.(true);await vi.advanceTimersByTimeAsync(0);
 expect(relay.client.connect).toHaveBeenCalledTimes(2);
 relay.recover?.(true);await vi.advanceTimersByTimeAsync(0);expect(relay.client.connect).toHaveBeenCalledTimes(2);
 relay.prepareHandshake?.();relay.cleanup();
 await vi.advanceTimersByTimeAsync(120_000);expect(relay.client.connect).toHaveBeenCalledTimes(2);
});

it('rejects every outbound message on an abandoned relay, including stale SDK signing replays',async()=>{
 vi.useFakeTimers();const relay=createWalletRelay(vi.fn());await vi.advanceTimersByTimeAsync(0);relay.cleanup();
 await expect(relay.client.relay({action:RelayMsgAction.SignTransactionRequest,time:0} as Parameters<typeof relay.client.relay>[0])).rejects.toThrow('Wallet relay closed');
});
