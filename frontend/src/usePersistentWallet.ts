import {useEffect, useRef, useState} from 'react';
import {DisconnectReason, RelayStatus, type WalletReadyMessage} from '@wizardconnect/core';
import {InvalidWalletSession, createWalletRelay} from './walletRelay';
import {DappConnectionManager, loadSession, type SessionStorage} from '@wizardconnect/dapp';

export const WALLET_SESSION_KEY = 'staking-arena-wizardconnect-v1';
const INVALID_SESSION_KEY = `${WALLET_SESSION_KEY}-invalid`;
export const RESTORE_WINDOW_MS = 30_000;
export type ConnectionState = 'idle'|'connecting'|'restoring'|'connected'|'reconnecting'|'offline'|'invalid';
export const walletDiagnostic = (transition: string) => console.info(`[Arena wallet] ${transition}`);

/** Owns exactly one SDK manager/relay. React effect replay is not an ownership change.
 * SDK persistence contains transport credentials, never BCH wallet keys or spending consent.
 */
class WalletOwner {
  state: ConnectionState = 'idle';
  manager: DappConnectionManager|null = null;
  uri: string|null = null;
  qrUri: string|null = null;
  error: string|null = null;
  extensions: unknown;
  private relay: ReturnType<typeof createWalletRelay>|null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;
  private expectedPaths = '';
  private listeners = new Set<() => void>();
  private memory = new Map<string,string>();
  private storageFailed = false;
  // Catch denied storage in every SDK call, including async walletready persistence.
  private storage: SessionStorage = {
    getItem: key => { try { return localStorage.getItem(key); } catch { this.storageUnavailable(); return this.memory.get(key) ?? null; } },
    setItem: (key,value) => {
      if (key === WALLET_SESSION_KEY && this.expectedPaths) {
        const next = JSON.parse(value);
        if (next.paths?.length && JSON.stringify(next.paths) !== this.expectedPaths) return;
      }
      this.memory.set(key,value); try { localStorage.setItem(key,value); } catch { this.storageUnavailable(); } },
    removeItem: key => { this.memory.delete(key); try { localStorage.removeItem(key); } catch { this.storageUnavailable(); } },
  };
  private storageUnavailable() { this.storageFailed = true; this.error = 'Browser storage is unavailable. This pairing can only survive this page; allow browser storage to reconnect on future visits.'; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  private saved() { return loadSession(WALLET_SESSION_KEY,this.storage); }
  start() {
    const saved = this.saved();
    if (this.storage.getItem(INVALID_SESSION_KEY)) { this.state='invalid'; this.emit(); return; }
    if (saved?.walletPublicKey) { walletDiagnostic('Saved pairing discovered'); this.open(true); }
    else if (saved) { this.state = 'invalid'; this.emit(); }
    else { this.emit(); }
  }
  private teardown() {
    this.clearTimers();
    const relay = this.relay; this.relay = null;
    const manager = this.manager; this.manager = null;
    manager?.removeAllListeners();
    // SDK walletready may still be awaiting its outgoing handshake. After that
    // event returns the SDK starts keepalive; stop it again after the handler.
    if (manager) manager.on('walletready',()=>queueMicrotask(()=>manager.destroy()));
    relay?.cleanup();
    manager?.destroy();
    if (manager) walletDiagnostic('Wallet manager destroyed');
  }
  private relayReachable() { return this.relay?.transportReachable?.() ?? this.relay?.client.isConnected() ?? false; }
  private window(restoring: boolean) {
    if (this.timers.length) return; // duplicate transport notifications do not extend the deadline
    this.state = restoring ? 'restoring' : 'reconnecting';
    walletDiagnostic(restoring ? 'Session restoration started' : 'Transport disconnected');
    for (const delay of [2_000,6_000,14_000]) this.timers.push(setTimeout(() => {
      const client = this.relay?.client;
      walletDiagnostic('Automatic reconnection attempted');
      // Re-send the supported SDK handshake on the SAME client; never pair again.
      if (client && this.relayReachable()) this.manager?.updateConnection(client,RelayStatus.connected());
    },delay));
    this.timers.push(setTimeout(() => {
      this.clearTimers();
      walletDiagnostic('Session restoration failed: retry window exhausted');
      this.state = this.saved()?.walletPublicKey ? 'offline' : 'invalid';
      // A live relay may passively deliver a later wallet handshake. No handshake
      // retry timers remain active. Close unreachable transports and keep pairing.
      if (!this.relayReachable()) this.teardown();
      this.emit();
    },RESTORE_WINDOW_MS));
    this.emit();
  }
  private open(restore: boolean) {
    if (this.stopped || ['connecting','restoring','reconnecting','connected'].includes(this.state)) return;
    const saved = restore ? this.saved() : null;
    if (restore && !saved?.walletPublicKey) { this.state = 'invalid'; this.emit(); return; }
    this.teardown();
    if (!this.storageFailed) this.error = null;
    this.uri = this.qrUri = null;
    this.expectedPaths = saved?.paths?.length ? JSON.stringify(saved.paths) : '';
    this.state = restore ? 'restoring' : 'connecting';
    let manager: DappConnectionManager;
    const storage: SessionStorage = {
      getItem:this.storage.getItem,
      setItem:(key,value)=>{if(this.manager === manager)this.storage.setItem(key,value);},
      removeItem:key=>{if(this.manager === manager)this.storage.removeItem(key);},
    };
    manager = new DappConnectionManager('Staking Arena',new URL('./arena.svg',window.location.href).href,{session:{key:WALLET_SESSION_KEY,storage}});
    this.manager = manager;
    walletDiagnostic('Wallet manager created');
    manager.on('walletready', (_message: WalletReadyMessage) => {
      if (this.manager !== manager) return;
      const identity = JSON.stringify(manager.getSessionPaths());
      if (this.expectedPaths && identity !== this.expectedPaths) {
        walletDiagnostic('Wallet identity changed; connection blocked');
        this.state = 'invalid'; this.storage.setItem(INVALID_SESSION_KEY,'1');
        // SDK persists after this event: defer teardown until that handler finishes.
        queueMicrotask(() => { if (this.manager === manager) { this.teardown(); this.emit(); } });
        this.emit(); return;
      }
      this.extensions = (_message.session.hdwalletv1 as {extensions?:unknown})?.extensions;
      this.expectedPaths = identity;
      this.clearTimers(); this.uri = this.qrUri = null;
      this.state = 'connected'; walletDiagnostic('Session restoration succeeded (live handshake)'); this.emit();
    });
    manager.on('reconnecting', () => { if (this.state === 'connected') this.window(false); });
    manager.on('disconnect', reason => {
      if (reason === DisconnectReason.ProtocolMismatch || this.state === 'connecting') {
        walletDiagnostic('Session invalidated by remote wallet');
        this.state = 'invalid'; this.storage.setItem(INVALID_SESSION_KEY,'1'); this.teardown(); this.emit();
      } else {
        // Cashonize also uses user_disconnect for keepalive recovery. It cannot
        // prove revocation. Retain pairing and let a bounded live handshake decide.
        walletDiagnostic('Remote disconnect received; saved pairing retained');
        if (this.state === 'connected') this.window(false);
      }
    });
    try {
      const relay = createWalletRelay(payload => {
        if (this.manager !== manager) return;
        if (payload.status.status === 'session_deleted') { this.state='invalid'; this.storage.setItem(INVALID_SESSION_KEY,'1'); this.teardown(); this.emit(); return; }
        if (['disconnected','reconnecting'].includes(payload.status.status) && this.state === 'connected') this.window(false);
        manager.updateConnection(payload.client,payload.status);
      },{existingCredentials:saved?.walletPublicKey ? {privateKey:saved.privateKey,secret:saved.secret,walletPublicKey:saved.walletPublicKey} : undefined,maxReconnectAttempts:3,reconnectInterval:2_000});
      this.relay = relay;
      manager.attachRelay(relay);
      if (!restore) { this.uri=relay.uri; this.qrUri=relay.qrUri; }
      // Bound initial approval too; no permanent spinner even if the wallet never opens.
      if (restore) this.window(true);
      else this.timers.push(setTimeout(() => { this.state=this.saved()?.walletPublicKey?'offline':'invalid'; this.teardown(); this.emit(); },120_000));
    } catch (error) {
      this.state = error instanceof InvalidWalletSession ? 'invalid' : restore ? 'offline' : 'idle';
      if (this.state === 'invalid') this.storage.setItem(INVALID_SESSION_KEY,'1');
      this.error = 'Wallet connection failed. Try again.';
      this.teardown();
    }
    this.emit();
  }
  connect = () => { if (this.saved()?.walletPublicKey) this.retry(); else this.open(false); };
  retry = () => {
    if (this.state !== 'offline') return;
    if (this.manager && this.relay && this.relayReachable()) {
      this.window(true); this.manager.updateConnection(this.relay.client,RelayStatus.connected());
    } else this.open(true);
  };
  replace = () => { this.teardown(); this.storage.removeItem(WALLET_SESSION_KEY); this.storage.removeItem(INVALID_SESSION_KEY); this.state='idle'; this.open(false); };
  disconnect = async () => {
    walletDiagnostic('Explicit disconnect');
    const manager=this.manager;
    // Courtesy notification must not hold the UI hostage to an offline relay.
    void manager?.sendDisconnect().catch(()=>{});
    this.state='idle'; this.teardown(); this.storage.removeItem(WALLET_SESSION_KEY); this.storage.removeItem(INVALID_SESSION_KEY);
    this.uri=this.qrUri=null; this.error=null; this.emit();
  };
  stop() { this.stopped=true; this.teardown(); }
}

export function usePersistentWallet() {
  const ownerRef = useRef<WalletOwner|null>(null);
  const lease = useRef(0);
  const [,render] = useState(0);
  useEffect(() => {
    const token = ++lease.current;
    const fresh = ownerRef.current === null;
    const owner = ownerRef.current ??= new WalletOwner();
    const unsubscribe = owner.subscribe(() => render(value=>value+1));
    if (fresh) owner.start();
    const recover = () => { if (document.visibilityState !== 'hidden') owner.retry(); };
    window.addEventListener('online',recover);
    window.addEventListener('focus',recover);
    document.addEventListener('visibilitychange',recover);
    render(value=>value+1);
    return () => {
      unsubscribe();
      window.removeEventListener('online',recover); window.removeEventListener('focus',recover); document.removeEventListener('visibilitychange',recover);
      // StrictMode replays setup synchronously. A real unmount releases ownership.
      queueMicrotask(() => { if (lease.current === token) { owner.stop(); ownerRef.current=null; } });
    };
  },[]);
  const owner=ownerRef.current;
  return {state:owner?.state??'idle',manager:owner?.manager??null,uri:owner?.uri,qrUri:owner?.qrUri,error:owner?.error,extensions:owner?.extensions,
    isLive:()=>owner?.state === 'connected',connect:()=>owner?.connect(),retry:()=>owner?.retry(),replace:()=>owner?.replace(),disconnect:async()=>owner?.disconnect()};
}
