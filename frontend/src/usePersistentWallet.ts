import {activeNetwork} from './activeNetwork';
import {useEffect, useRef, useState} from 'react';
import {RelayMsgAction, RelayStatus, type WalletReadyMessage} from '@wizardconnect/core';
import {InvalidWalletSession, createWalletRelay} from './walletRelay';
import {DappConnectionManager, loadSession, type SessionStorage} from '@wizardconnect/dapp';

export const WALLET_SESSION_KEY = 'staking-arena-wizardconnect-v1'+(activeNetwork==='chipnet'?'':'-'+activeNetwork);
const INVALID_SESSION_KEY = `${WALLET_SESSION_KEY}-invalid`;
export const RESTORE_WINDOW_MS = 30_000;
export type ConnectionState = 'idle'|'connecting'|'restoring'|'connected'|'reconnecting'|'offline'|'invalid';
export const walletDiagnostic = (transition: string) => console.info(`[Arena wallet +${Math.round(performance.now())}ms] ${transition}`);

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
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryAttempt = 0;
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
    clearTimeout(this.recoveryTimer); this.recoveryTimer = undefined;
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
  private scheduleRecovery() {
    if (this.stopped || this.recoveryTimer || !['restoring','reconnecting','offline'].includes(this.state)) return;
    const delay = Math.min(30_000, 2_000 * 2 ** Math.min(this.recoveryAttempt++, 4));
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      this.handshake();
      this.scheduleRecovery();
    }, delay);
  }
  private handshake() {
    if (this.stopped || !['restoring','reconnecting','offline'].includes(this.state) || navigator.onLine === false) return;
    if (!this.manager || !this.relay) { this.open(true); return; }
    // Subscription readiness is a transport hint, never wallet authorization.
    // Do not start the SDK's asynchronous key-exchange wait loop repeatedly.
    if (this.relayReachable() && this.relay.client.isKeyExchangeComplete()) {
      this.relay.prepareHandshake?.();
      walletDiagnostic('Saved-session handshake requested');
      this.manager.updateConnection(this.relay.client,RelayStatus.connected());
    }
  }
  private window(restoring: boolean) {
    if (['restoring','reconnecting','offline'].includes(this.state) && this.recoveryTimer) return;
    this.clearTimers();
    this.state = restoring ? 'restoring' : 'reconnecting';
    this.recoveryAttempt = 0;
    walletDiagnostic(restoring ? 'Session restoration started' : 'Wallet liveness lost');
    this.scheduleRecovery();
    this.timers.push(setTimeout(() => {
      this.clearTimers();
      if (!['restoring','reconnecting'].includes(this.state)) return;
      this.state = 'offline';
      walletDiagnostic('Recovery delayed; automatic retries continue (maximum 30s interval)');
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
    manager = new DappConnectionManager('Stake Arena',new URL('./mark.jpg',window.location.href).href,{session:{key:WALLET_SESSION_KEY,storage}});
    this.manager = manager;
    walletDiagnostic('Wallet manager created');
    manager.on('messagesent', message => {
      if (message.action === RelayMsgAction.DappReady) walletDiagnostic('Wallet handshake published');
    });
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
      this.clearTimers(); clearTimeout(this.recoveryTimer); this.recoveryTimer=undefined; this.recoveryAttempt=0; this.uri = this.qrUri = null;
      this.state = 'connected'; walletDiagnostic('Session restoration succeeded (live handshake)'); this.emit();
    });
    manager.on('reconnecting', () => { if (this.state === 'connected') this.window(false); });
    // Revoke financial liveness immediately; the SDK gives Cashonize an 8s
    // grace period for watchdog reconnects before reporting remote disconnect.
    manager.on('messagereceived', message => {
      if (message.action === RelayMsgAction.Disconnect) {
        if (this.state === 'connected') this.window(false);
        // Invalidate transaction authorization/abort pending approvals now, not
        // eight seconds later when the SDK's remote-disconnect grace expires.
        manager.updateConnection(this.relay?.client,RelayStatus.reconnecting('Remote wallet disconnected'));
      }
    });
    manager.on('disconnect', () => {
      if (this.manager !== manager) return;
      walletDiagnostic('Remote disconnect/revocation confirmed after SDK grace');
      this.state = 'invalid'; this.storage.setItem(INVALID_SESSION_KEY,'1'); this.teardown(); this.emit();
    });
    try {
      const relay = createWalletRelay(payload => {
        if (this.manager !== manager) return;
        if (payload.status.status === 'session_deleted') { this.state='invalid'; this.storage.setItem(INVALID_SESSION_KEY,'1'); this.teardown(); this.emit(); return; }
        if (['disconnected','reconnecting'].includes(payload.status.status) && this.state === 'connected') this.window(false);
        if (payload.status.status === 'connected') {
          if (this.state === 'connected') return;
          walletDiagnostic('Transport subscription ready (wallet handshake unconfirmed)');
          // Attach once without launching an uncontrolled SDK handshake loop.
          manager.updateConnection(payload.client,RelayStatus.disconnected());
          if (restore || this.state !== 'connecting') this.handshake();
          else manager.updateConnection(payload.client,payload.status);
        } else manager.updateConnection(payload.client,payload.status);
      },{existingCredentials:saved?.walletPublicKey ? {privateKey:saved.privateKey,secret:saved.secret,walletPublicKey:saved.walletPublicKey} : undefined});
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
      if (restore && this.state === 'offline') this.scheduleRecovery();
    }
    this.emit();
  }
  connect = () => { if (this.saved()?.walletPublicKey) this.retry(); else this.open(false); };
  retry = (refreshSubscription = true) => {
    if (!['offline','restoring','reconnecting'].includes(this.state)) return;
    this.relay?.recover?.(refreshSubscription);
    this.handshake();
    this.scheduleRecovery();
  };
  offline = () => {
    if (this.state === 'connected') this.window(false);
    if (this.manager && this.relay) this.manager.updateConnection(this.relay.client,RelayStatus.reconnecting('Browser offline'));
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
    const recover = () => { if (document.visibilityState !== 'hidden') owner.retry(false); };
    window.addEventListener('online',recover);
    window.addEventListener('offline',owner.offline);
    window.addEventListener('focus',recover);
    document.addEventListener('visibilitychange',recover);
    render(value=>value+1);
    return () => {
      unsubscribe();
      window.removeEventListener('offline',owner.offline);
      window.removeEventListener('online',recover); window.removeEventListener('focus',recover); document.removeEventListener('visibilitychange',recover);
      // StrictMode replays setup synchronously. A real unmount releases ownership.
      queueMicrotask(() => { if (lease.current === token) { owner.stop(); ownerRef.current=null; } });
    };
  },[]);
  const owner=ownerRef.current;
  return {state:owner?.state??'idle',manager:owner?.manager??null,uri:owner?.uri,qrUri:owner?.qrUri,error:owner?.error,extensions:owner?.extensions,
    isLive:()=>owner?.state === 'connected',connect:()=>owner?.connect(),retry:()=>owner?.retry(),replace:()=>owner?.replace(),disconnect:async()=>owner?.disconnect()};
}
