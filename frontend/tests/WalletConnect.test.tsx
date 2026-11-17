vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',selectedNetwork:()=> 'chipnet',networkLeaving:false,switchNetwork:vi.fn()}));
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey} from '@bitauth/libauth';
import {StrictMode} from 'react';
import {DappConnectionManager} from '@wizardconnect/dapp';
import {RESTORE_WINDOW_MS} from '../src/usePersistentWallet';
import { EventEmitter } from 'node:events';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {createWalletRelay as initiateDappRelay} from '../src/walletRelay';
import { PROTOCOL_NAME, RelayMsgAction } from '@wizardconnect/core';
import WalletConnect from '../src/WalletConnect';
import { browserWalletClient } from '../src/browserWalletClient';

vi.mock('../src/browserWalletClient', () => ({ browserWalletClient: vi.fn(() => ({ browser:true, close:vi.fn() })) }));

// Exercise production ownership and the real SDK handshake manager with a simulated transport.
vi.mock('../src/walletRelay', async importOriginal => ({...await importOriginal<typeof import('../src/walletRelay')>(),createWalletRelay:vi.fn()}));
const sessionKey = 'staking-arena-wizardconnect-v1';
const client = Object.assign(new EventEmitter(), {
  relay: vi.fn(async (_message: { action: string }) => {}),
  isKeyExchangeComplete: () => true,
  isConnected: vi.fn(() => true),
  setPeerCapabilities: vi.fn(),
});
const cleanup = vi.fn();
const events = new EventEmitter();
const uri = 'wiz://test-pairing';

beforeEach(() => {
  client.removeAllListeners();
  events.removeAllListeners();
  cleanup.mockClear();
  client.isConnected.mockReturnValue(true);
  client.relay.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.mocked(initiateDappRelay).mockReset().mockImplementation((_callback,options) => ({
    uri, qrUri: 'WIZ://TEST-PAIRING', client, events, cleanup,
    credentials: { privateKey: options?.existingCredentials?.privateKey ?? 'test-private-key', secret: options?.existingCredentials?.secret ?? 'test-secret' },
  } as unknown as ReturnType<typeof initiateDappRelay>));
});

async function walletReady(paths: {name:string;xpub:string}[] = []) {
  await act(async () => {
    const callback = vi.mocked(initiateDappRelay).mock.calls.at(-1)![0];
    callback({ client, status: { status: 'connected' } } as unknown as unknown as Parameters<typeof callback>[0]);
    events.emit('keyexchangecomplete', new Uint8Array([1, 2]));
    client.emit('message', {
      action: RelayMsgAction.WalletReady,
      wallet_name: 'Test BCH Wallet', wallet_icon: '', dapp_discovered: true,
      supported_protocols: [PROTOCOL_NAME], session: { [PROTOCOL_NAME]: { paths } },
    });
  });
}

it('starts pairing only on click and cancels with cleanup and cleared credentials', async () => {
  render(<WalletConnect/>);
  expect(initiateDappRelay).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  const dialog=screen.getByRole('dialog');expect(dialog).toBeVisible();
  expect(within(dialog).getByLabelText('Connection URI')).toHaveValue(uri);
  expect(within(dialog).getByRole('link', { name: 'Open wallet' })).toHaveAttribute('href', uri);
  expect(localStorage.getItem(sessionKey)).toContain('test-private-key');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel wallet connection' }));
  await screen.findByRole('button', { name: 'Connect Wallet' });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(localStorage.getItem(sessionKey)).toBeNull();
});

it('handles a real SDK wallet-ready handshake, persists the session and disconnects', async () => {
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  await walletReady();
  expect(screen.getByText('Connected to Cashonize')).toBeInTheDocument();
  expect(document.querySelector('.wallet-network-note')).toBeNull();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(sessionKey)!)).toMatchObject({ walletName: 'Test BCH Wallet', walletPublicKey: '0102' });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  await screen.findByRole('button', { name: 'Connect Wallet' });
  expect(client.relay).toHaveBeenCalledWith(expect.objectContaining({ action: RelayMsgAction.Disconnect }));
  expect(client.relay.mock.calls.every(([message]) => message.action !== RelayMsgAction.SignTransactionRequest)).toBe(true);
  expect(localStorage.getItem(sessionKey)).toBeNull();
});

it('keeps the browser worker across repeated identical wallet-ready messages', async () => {
  const onTransactions=vi.fn();
  render(<WalletConnect browser onTransactions={onTransactions}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  await walletReady();
  vi.mocked(browserWalletClient).mockClear();
  onTransactions.mockClear();
  await walletReady();
  expect(browserWalletClient).not.toHaveBeenCalled();
  expect(onTransactions).not.toHaveBeenCalled();
});

it('restores a paired session without showing another QR code', async () => {
  localStorage.setItem(sessionKey, JSON.stringify({ privateKey: 'saved-key', secret: 'saved-secret', walletPublicKey: '0102', walletName: 'Test BCH Wallet' }));
  render(<WalletConnect/>);
  expect(screen.getByText('Cashonize paired · Wallet offline')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(initiateDappRelay).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ existingCredentials: { privateKey: 'saved-key', secret: 'saved-secret', walletPublicKey: '0102' } }));
  await walletReady();
  expect(screen.getByText('Connected to Cashonize')).toBeInTheDocument();
});

it('shows startup errors and allows retry', async () => {
  vi.mocked(initiateDappRelay).mockImplementationOnce(() => { throw Error('Relay unavailable'); });
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Wallet connection failed. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('offers manual copying when the clipboard is unavailable', async () => {
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy connection URI' }));
  await screen.findByText('Select and copy the connection URI below.');
});

afterEach(()=>vi.useRealTimers());

it('keeps the manager and worker alive through rerenders and transport reconnection', async()=>{
  const destroyed=vi.spyOn(DappConnectionManager.prototype,'destroy');
  const onTransactions=vi.fn();
  const view=render(<StrictMode><WalletConnect browser onTransactions={onTransactions}/></StrictMode>);
  fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));
  await walletReady();
  const workerCalls=vi.mocked(browserWalletClient).mock.calls.length;
  view.rerender(<StrictMode><WalletConnect browser onTransactions={onTransactions} targetLabel="Make an Offer"/></StrictMode>);
  await act(async()=>{const callback=vi.mocked(initiateDappRelay).mock.calls.at(-1)![0];callback({client,status:{status:'reconnecting'}} as unknown as Parameters<typeof callback>[0]);});
  expect(screen.getByText('Cashonize paired · Wallet offline')).toBeVisible();
  await walletReady();
  expect(destroyed).not.toHaveBeenCalled();
  expect(browserWalletClient).toHaveBeenCalledTimes(workerCalls);
  expect(initiateDappRelay).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async()=>{});
  expect(destroyed).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
});

it('restores only once under StrictMode and never trusts cached wallet paths before a handshake',async()=>{
  localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102',paths:[]}));
  const onTransactions=vi.fn();
  render(<StrictMode><WalletConnect browser onTransactions={onTransactions}/></StrictMode>);
  expect(initiateDappRelay).toHaveBeenCalledOnce();
  expect(screen.getByText('Cashonize paired · Wallet offline')).toBeVisible();
  const check=vi.mocked(browserWalletClient).mock.calls.at(-1)![1];
  expect(check).toThrow('live chipnet wallet session');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await walletReady();
  expect(screen.getByText('Connected to Cashonize')).toBeVisible();
});

it('continues offline restoration, preserves pairing and journals, recovers on availability without QR',async()=>{
  vi.useFakeTimers();
  client.isConnected.mockReturnValue(false);
  localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102'}));
  localStorage.setItem('arena-test-pending-journal','pending recovery');
  render(<WalletConnect/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);});
  expect(screen.getByText(/Cashonize paired · Wallet offline/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'Retry saved connection'})).toBeNull();expect(screen.getByRole('button',{name:'Pair wallet again'})).toBeVisible();
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(sessionKey)).toContain('saved-key');
  await act(async()=>{await vi.advanceTimersByTimeAsync(600_000);});
  expect(vi.mocked(initiateDappRelay).mock.calls.length).toBeGreaterThan(2);
  fireEvent(window,new Event('online'));
  expect(vi.mocked(initiateDappRelay).mock.calls.length).toBeGreaterThan(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await walletReady();
  expect(screen.getByText('Connected to Cashonize')).toBeVisible();
  expect(localStorage.getItem('arena-test-pending-journal')).toBe('pending recovery');
});

it('clearly marks a protocol-rejected session invalid without starting a QR or retry loop',async()=>{
  vi.useFakeTimers();
  render(<WalletConnect/>);
  fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));
  await walletReady();
  await act(async()=>{client.emit('message',{action:RelayMsgAction.Disconnect,reason:'protocol_mismatch'}); await vi.advanceTimersByTimeAsync(8_000);});
  expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(120_000);});
  expect(initiateDappRelay).toHaveBeenCalledOnce();
});

it('handles unavailable browser storage without crashing',()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
  render(<WalletConnect/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('accepts a late wallet handshake passively after the retry deadline on a reachable relay',async()=>{
  vi.useFakeTimers();
  localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102'}));
  render(<WalletConnect/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);});
  expect(screen.queryByRole('button',{name:'Retry saved connection'})).toBeNull();expect(screen.getByRole('button',{name:'Pair wallet again'})).toBeVisible();
  expect(cleanup).toHaveBeenCalledTimes(2);
  await walletReady();
  expect(screen.getByText('Connected to Cashonize')).toBeVisible();
  expect(initiateDappRelay).toHaveBeenCalledTimes(3);
});

it('rejects changed wallet derivation identity and preserves the previously accepted identity',async()=>{
 const encoded=encodeHdPublicKey({node:deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88))),network:'testnet'});
 if(typeof encoded==='string')throw Error(encoded);
 render(<WalletConnect/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));
 await walletReady();
 await walletReady([{name:'receive',xpub:encoded.hdPublicKey}]);
 expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
 expect(JSON.parse(localStorage.getItem(sessionKey)!).paths).toEqual([]);
});

it('retains pairing after an ambiguous Cashonize keepalive disconnect and recovers on the same manager',async()=>{
 const invalidated=vi.spyOn((await import('../src/walletNetwork')).WalletNetworkSession.prototype,'invalidate');
 vi.useFakeTimers();render(<WalletConnect/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady();invalidated.mockClear();
 await act(async()=>{client.emit('message',{action:RelayMsgAction.Disconnect,reason:'user_disconnect'});await vi.advanceTimersByTimeAsync(4_000);});
 expect(screen.getByText('Cashonize paired · Wallet offline')).toBeVisible();
 expect(invalidated).toHaveBeenCalled();
 expect(localStorage.getItem(sessionKey)).not.toBeNull();
 await walletReady();expect(screen.getByText('Connected to Cashonize')).toBeVisible();
 expect(initiateDappRelay).toHaveBeenCalledOnce();
});

it('does not resurrect session storage or keepalive when a handshake finishes after explicit disconnect',async()=>{
 vi.useFakeTimers();
 let finish!:()=>void;
 client.relay.mockImplementation(message=>message.action===RelayMsgAction.DappReady?new Promise<void>(resolve=>{finish=resolve;}):Promise.resolve());
 render(<WalletConnect/>);fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));
 await act(async()=>{
  const callback=vi.mocked(initiateDappRelay).mock.calls.at(-1)![0];
  callback({client,status:{status:'connected'}} as unknown as Parameters<typeof callback>[0]);
  client.emit('message',{action:RelayMsgAction.WalletReady,wallet_name:'Cashonize',wallet_icon:'',dapp_discovered:false,supported_protocols:[PROTOCOL_NAME],session:{[PROTOCOL_NAME]:{paths:[]}}});
 });
 fireEvent.click(screen.getByRole('button',{name:'Cancel connection'}));
 await act(async()=>{finish();await Promise.resolve();await vi.advanceTimersByTimeAsync(0);});
 expect(localStorage.getItem(sessionKey)).toBeNull();
 expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
 expect(vi.getTimerCount()).toBe(0);
});

it('automatically retries a delayed wallet beyond 30s while visible, without Retry',async()=>{
 vi.useFakeTimers();
 localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102'}));
 render(<StrictMode><WalletConnect/></StrictMode>);
 const requests: number[]=[];
 client.relay.mockImplementation(async message=>{
  if(message.action!==RelayMsgAction.DappReady)return;
  requests.push(Date.now());
  if(requests.length===5)queueMicrotask(()=>client.emit('message',{
   action:RelayMsgAction.WalletReady,wallet_name:'Cashonize',wallet_icon:'',dapp_discovered:true,
   supported_protocols:[PROTOCOL_NAME],session:{[PROTOCOL_NAME]:{paths:[]}},
  }));
 });
 await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
 expect(requests).toHaveLength(5); // Bounded fresh manager recovery also restarts proactive probes.
 expect(screen.getByText('Connected to Cashonize')).toBeVisible();
 expect(initiateDappRelay).toHaveBeenCalledTimes(2);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('connects once, closes the page, then restores automatically against the still-paired wallet',async()=>{
 vi.useFakeTimers();
 const first=render(<WalletConnect/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady();
 first.unmount();await act(async()=>{});
 client.removeAllListeners();events.removeAllListeners();
 render(<StrictMode><WalletConnect/></StrictMode>);
 client.relay.mockImplementation(async message=>{
  if(message.action===RelayMsgAction.DappReady)queueMicrotask(()=>client.emit('message',{
   action:RelayMsgAction.WalletReady,wallet_name:'Cashonize',wallet_icon:'',dapp_discovered:true,
   supported_protocols:[PROTOCOL_NAME],session:{[PROTOCOL_NAME]:{paths:[]}},
  }));
 });
 await act(async()=>{await vi.advanceTimersByTimeAsync(2_000);});
 expect(screen.getByText('Connected to Cashonize')).toBeVisible();
 expect(initiateDappRelay).toHaveBeenCalledTimes(2);
 expect(vi.mocked(initiateDappRelay).mock.calls[1][1]?.existingCredentials?.walletPublicKey).toBe('0102');
 expect(client.relay.mock.calls.every(([m])=>m.action!==RelayMsgAction.SignTransactionRequest)).toBe(true);
});

it('suspends wallet handshakes offline and recovers immediately on internet return',async()=>{
 vi.useFakeTimers();
 localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102'}));
 const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
 render(<WalletConnect/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(90_000);});
 expect(client.relay).not.toHaveBeenCalled();
 online.mockReturnValue(true);fireEvent(window,new Event('online'));
 expect(client.relay).toHaveBeenCalledWith(expect.objectContaining({action:RelayMsgAction.DappReady}));
 await walletReady();
 expect(screen.getByText('Connected to Cashonize')).toBeVisible();
 fireEvent(window,new Event('offline'));
 expect(screen.getByText('Cashonize paired · Wallet offline')).toBeVisible();
 await walletReady();expect(screen.getByText('Connected to Cashonize')).toBeVisible();
});

it('explicit disconnect and wallet revocation stop automatic restoration across reopening',async()=>{
 vi.useFakeTimers();
 const view=render(<WalletConnect/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady();
 await act(async()=>{client.emit('message',{action:RelayMsgAction.Disconnect,reason:'user_disconnect'});await vi.advanceTimersByTimeAsync(8_000);});
 expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
 view.unmount();await act(async()=>{});
 const again=render(<WalletConnect/>);
 fireEvent(window,new Event('online'));await act(async()=>{await vi.advanceTimersByTimeAsync(300_000);});
 expect(initiateDappRelay).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Disconnect'}));
 again.unmount();await act(async()=>{});
 render(<WalletConnect/>);fireEvent(window,new Event('focus'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(300_000);});
 expect(initiateDappRelay).toHaveBeenCalledOnce();expect(localStorage.getItem(sessionKey)).toBeNull();
});

it('does not let recovery replacement erase an authenticated revocation grace timer',async()=>{
 vi.useFakeTimers();render(<WalletConnect/>);
 fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady();
 await act(async()=>{client.emit('reconnecting');});
 // Use the manager's actual event via the existing transport status callback.
 await act(async()=>{const callback=vi.mocked(initiateDappRelay).mock.calls.at(-1)![0];callback({client,status:{status:'reconnecting'}} as unknown as Parameters<typeof callback>[0]);await vi.advanceTimersByTimeAsync(7_000);});
 await act(async()=>{client.emit('message',{action:RelayMsgAction.Disconnect,reason:'user_disconnect'});await vi.advanceTimersByTimeAsync(8_000);});
 expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
 expect(initiateDappRelay).toHaveBeenCalledOnce();
});

it('remembers verified receive/0 only for the authenticated identity/network, labels offline/reload, and clears on disconnect',async()=>{
 const {WALLET_ADDRESS_KEY}=await import('../src/usePersistentWallet');
 const encoded=encodeHdPublicKey({node:deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88))),network:'testnet'});
 if(typeof encoded==='string')throw Error(encoded);
 const paths=[{name:'receive',xpub:encoded.hdPublicKey}];
 const first=render(<WalletConnect/>);fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady(paths);
 const record=JSON.parse(localStorage.getItem(WALLET_ADDRESS_KEY)!);expect(record).toMatchObject({network:'chipnet',address:expect.stringMatching(/^bchtest:/)});
 expect(screen.getByTitle(record.address)).toHaveTextContent(/^Address:/);
 fireEvent(window,new Event('offline'));expect(screen.getByTitle(record.address)).toHaveTextContent('Last connected address:');
 first.unmount();await act(async()=>{});client.removeAllListeners();events.removeAllListeners();
 render(<WalletConnect/>);expect(screen.getByText('Cashonize paired · Wallet offline')).toBeVisible();expect(screen.getByTitle(record.address)).toHaveTextContent('Last connected address:');expect(screen.getByTitle(record.address).previousElementSibling).toHaveTextContent('Cashonize paired');expect(screen.queryByText(/Open Cashonize to reconnect/)).toBeNull();expect(screen.queryByText(/Pairing is saved in this browser profile/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Disconnect'}));await act(async()=>{});
 expect(localStorage.getItem(WALLET_ADDRESS_KEY)).toBeNull();expect(screen.queryByTitle(record.address)).not.toBeInTheDocument();
});
it.each(['replace','identity','revoked'])('clears last address on %s without authorizing cached data',async reason=>{
 const {WALLET_ADDRESS_KEY}=await import('../src/usePersistentWallet');vi.useFakeTimers();
 const key=(seed:number)=>{const e=encodeHdPublicKey({node:deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(seed))),network:'testnet'});if(typeof e==='string')throw Error(e);return [{name:'receive',xpub:e.hdPublicKey}];};
 render(<WalletConnect/>);fireEvent.click(screen.getByRole('button',{name:'Connect Wallet'}));await walletReady(key(88));expect(localStorage.getItem(WALLET_ADDRESS_KEY)).not.toBeNull();
 if(reason==='replace'){
  fireEvent(window,new Event('offline'));await act(async()=>{await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);});fireEvent.click(screen.getByRole('button',{name:'Pair wallet again'}));
 }else if(reason==='identity')await walletReady(key(89));
 else await act(async()=>{client.emit('message',{action:RelayMsgAction.Disconnect,reason:'user_disconnect'});await vi.advanceTimersByTimeAsync(8000);});
 expect(localStorage.getItem(WALLET_ADDRESS_KEY)).toBeNull();expect(screen.queryByText(/Last connected address:/)).toBeNull();
});
it('does not display an address cached for another pairing or network, and cached paths never authorize',async()=>{
 const {WALLET_ADDRESS_KEY}=await import('../src/usePersistentWallet');
 localStorage.setItem(sessionKey,JSON.stringify({privateKey:'saved-key',secret:'saved-secret',walletPublicKey:'0102',paths:[]}));
 localStorage.setItem(WALLET_ADDRESS_KEY,JSON.stringify({network:'mainnet',identity:'unrelated',address:'bitcoincash:untrusted'}));
 const onTransactions=vi.fn();render(<WalletConnect browser onTransactions={onTransactions}/>);
 expect(screen.queryByText(/Last connected address/)).toBeNull();expect(vi.mocked(browserWalletClient).mock.calls.at(-1)![1]).toThrow('live chipnet wallet session');
});
