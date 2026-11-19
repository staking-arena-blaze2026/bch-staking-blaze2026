import {networkLeaving} from './activeNetwork';
import {browserWalletClient} from './browserWalletClient';
import { binToHex, hexToBin } from '@bitauth/libauth';
import { transactionApi, wizardWireTransaction, type WalletTransactions } from './walletTransactions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlphanumericQRCode } from '@wizardconnect/react';
import { usePersistentWallet } from './usePersistentWallet';
import type { WalletReadyMessage } from '@wizardconnect/core';
import { assertTransactionSession, createStakingTransactionBoundary, CHIPNET_NETWORK, WalletNetworkSession, type NetworkRequirement } from './walletNetwork';

function PairingDialog({ uri, qrUri, onClose }: { uri: string; qrUri: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopyStatus('Connection URI copied.');
    } catch {
      setCopyStatus('Select and copy the connection URI below.');
    }
  }

  return <dialog ref={dialog} className="wallet-dialog" aria-labelledby="wallet-title" aria-describedby="wallet-instructions" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="wallet-dialog-heading"><h2 id="wallet-title">Connect with WizardConnect</h2><button className="refresh" type="button" onClick={onClose} aria-label="Cancel wallet connection">Close</button></div>
    <p id="wallet-instructions">Scan with a WizardConnect-compatible wallet, or paste the connection URI into your wallet.</p>
    <div className="wallet-qr"><AlphanumericQRCode value={qrUri} size={240}/></div>
    <label>Connection URI<input aria-label="Connection URI" value={uri} readOnly onFocus={event => event.target.select()}/></label>
    <div className="wallet-dialog-actions"><button type="button" className="refresh" onClick={() => { void copy(); }}>Copy connection URI</button><a className="button" href={uri}>Open wallet</a></div>
    <p role="status">{copyStatus || 'Waiting for wallet approval…'}</p>
    <small>Connecting shares public wallet information. Select the matching wallet network. Mainnet spends real BCH and requires explicit Cashonize approval for each signing request.</small>
  </dialog>;
}

const defaultRequirement = () => CHIPNET_NETWORK;

export default function WalletConnect({ browser=false, getRequiredNetwork = defaultRequirement, onTransactions }: { browser?:boolean; getRequiredNetwork?: () => NetworkRequirement | null; targetLabel?: string; onTransactions?: (client: WalletTransactions | null) => void }) {
  const control = useRef<HTMLDivElement>(null);
  const wasActive = useRef(false);
  const wallet = usePersistentWallet();
  const walletRef = useRef(wallet); walletRef.current = wallet;
  const requirement = useRef(getRequiredNetwork);
  requirement.current = getRequiredNetwork;
  const networkSession = useMemo(() => new WalletNetworkSession(() => wallet.manager?.getSessionPaths() ?? []), [wallet.manager]);
  const liveState = useRef(wallet.isLive);
  const warmWallet = useRef<(()=>void)|undefined>(undefined);
  liveState.current = wallet.isLive;
  const transactions = useMemo(() => createStakingTransactionBoundary(networkSession, () => requirement.current()), [networkSession]);
  const [, refreshNetwork] = useState(0);
  useEffect(() => {
    const manager = wallet.manager;
    if (!manager) return;
    const ready = (message: WalletReadyMessage) => {
      const session = message.session.hdwalletv1 as { extensions?: unknown };
      const previous = JSON.stringify(networkSession.read());
      if (wallet.manager?.getSessionPaths() && wallet.manager.protocol === 'hdwalletv1') networkSession.accept(session.extensions);
      // Wallets may repeat an identical handshake. Keep ongoing public scans and
      // explicit approvals alive unless the accepted identity/network changes.
      if (JSON.stringify(networkSession.read()) !== previous) refreshNetwork(version => version + 1);
    };
    const invalidate = () => { networkSession.invalidate(); refreshNetwork(version => version + 1); };
    manager.on('walletready', ready);
    manager.on('reconnecting', invalidate);
    manager.on('disconnect', invalidate);
    // A live handshake may precede this effect; cached paths alone are never trusted.
    if (wallet.state === 'connected' && manager.protocol === 'hdwalletv1' && manager.isWalletDiscovered()) {
      networkSession.accept(wallet.extensions);
      refreshNetwork(version => version + 1);
    }
    return () => {
      networkSession.invalidate();
      manager.off('walletready', ready);
      manager.off('reconnecting', invalidate);
      manager.off('disconnect', invalidate);
    };
  }, [wallet.manager, networkSession]);
  useEffect(() => {
    const manager = wallet.manager;
    if (!onTransactions) return;
    function check() {
      if (!liveState.current()) throw Error('A live chipnet wallet session is required');
      if(networkLeaving)throw Error('Network changed; reconnect and review');
      assertTransactionSession(networkSession, requirement.current());
    }
    if(browser) {
      const client=browserWalletClient(manager,check,()=>networkSession.revision,()=>walletRef.current.offlineDerivation());
      client.pairing=()=>walletRef.current.pairing();client.restore=()=>walletRef.current.retry();onTransactions(client);
      const warm=()=>{if(liveState.current())void client.warmQueue?.();};
      warmWallet.current=warm;
      document.addEventListener('visibilitychange',warm);
      const timer=setInterval(()=>{if(liveState.current())void client.warmQueue?.(false);},25000);
      return()=>{warmWallet.current=undefined;clearInterval(timer);document.removeEventListener('visibilitychange',warm);client.close?.();onTransactions(null);};
    }
    if(!manager)return;
    const publicKey = () => {
      check();
      const key = manager!.getPubkey(0,0n);
      if (!key) throw Error('Wallet receive key is unavailable');
      return binToHex(key);
    };
    const lifetime = new AbortController();
    onTransactions({ publicKey, async execute(intent) {
      const revision=networkSession.revision;
      const signing=new AbortController();
      const abort=()=>signing.abort();
      manager.on('reconnecting',abort); manager.on('disconnect',abort);
      lifetime.signal.addEventListener('abort',abort);
      const approvalCheck=()=>{check();if(lifetime.signal.aborted || revision!==networkSession.revision)throw Error('Wallet authorization changed; review and retry');};
      try {
      approvalCheck();
      const key = publicKey(), paths = JSON.stringify(manager.getSessionPaths());
      const prepared = await transactionApi('plan',{...intent,publicKey:key});
      approvalCheck();
      if (prepared.network !== 'chipnet' || prepared.genesis !== CHIPNET_NETWORK.genesisHash || JSON.stringify(manager.getSessionPaths()) !== paths) throw Error('Network or wallet changed during transaction preparation');
      const plan = JSON.parse(JSON.stringify(prepared.plan),(_k,v) => v && typeof v === 'object' && 'bytes' in v ? hexToBin(v.bytes) : v && typeof v === 'object' && 'bigint' in v ? BigInt(v.bigint) : v && v.type === 'Buffer' ? new Uint8Array(v.data) : v);
      const result = await manager.signTransaction({transaction:wizardWireTransaction(plan.request),inputPaths:plan.inputPaths},{signal:signing.signal});
      approvalCheck();
      if (JSON.stringify(manager.getSessionPaths()) !== paths) throw Error('Wallet changed while signing');
      if (result.error || !result.signedTransaction) throw Error('Wallet declined transaction signing');
      return transactionApi('submit',{id:prepared.id,signedTransaction:result.signedTransaction});
      } finally {manager.off('reconnecting',abort);manager.off('disconnect',abort);lifetime.signal.removeEventListener('abort',abort);}
    }});
    return () => {lifetime.abort();onTransactions(null);};
  }, [wallet.manager, networkSession, onTransactions,browser]);
  useEffect(()=>{
    if(wallet.state==='connected')warmWallet.current?.();
  },[wallet.state,wallet.manager,browser]);
  const compatibility = transactions.check();
  const declaredNetwork = networkSession.read().network;
  const hideChipnetUndeclaredNote = requirement.current()?.network === 'chipnet' && declaredNetwork.source !== 'invalid' && (declaredNetwork.network === 'unknown' || declaredNetwork.network === 'testnet');
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const active = wallet.state === 'connected' || wallet.state === 'connecting' || wallet.state === 'reconnecting' || wallet.state === 'restoring';
  useEffect(() => {
    if (wasActive.current && !active) control.current?.querySelector('button')?.focus();
    wasActive.current = active;
  }, [active]);

  async function disconnect() {
    if (closing) return;
    setClosing(true);
    setError('');
    try { await wallet.disconnect(); }
    catch { setError('Could not disconnect the wallet. Try again.'); }
    finally { setClosing(false); }
  }

  return <div ref={control} className="wallet-control">
    <div className="wallet-identity">
      {(active || wallet.state === 'offline') && <span className="wallet-status" role="status">{wallet.state === 'connected' ? 'Connected to Cashonize' : wallet.state === 'connecting' ? 'Waiting for Cashonize approval…' : 'Cashonize paired · Wallet offline'}</span>}
      {wallet.state === 'invalid' && <span className="wallet-status" role="status">The saved pairing is unavailable, revoked or incompatible. New pairing is necessary.</span>}
      {wallet.address && <small title={wallet.address}>{wallet.state === 'connected' ? 'Address' : 'Last connected address'}: {wallet.address.split(':')[1]?.slice(0,8)}…{wallet.address.slice(-8)}</small>}
    </div>
    <div className="wallet-actions">
      {active ? <>
        {wallet.pairing().paired && wallet.state !== 'connected' && wallet.state !== 'connecting' && <button type="button" className="refresh" onClick={wallet.replace}>Pair wallet again</button>}
        <button type="button" className="refresh" disabled={closing} onClick={() => { void disconnect(); }}>{closing ? 'Disconnecting…' : wallet.state === 'connecting' ? 'Cancel connection' : 'Disconnect'}</button>
      </> : wallet.state === 'offline' ? <>
        <button type="button" className="refresh" onClick={wallet.replace}>Pair wallet again</button>
        <button type="button" className="refresh" onClick={() => { void disconnect(); }}>Disconnect</button>
      </> : wallet.state === 'invalid' ? <>
        <button type="button" className="refresh" onClick={wallet.replace}>Connect Wallet</button>
        <button type="button" className="refresh" onClick={() => { void disconnect(); }}>Disconnect</button>
      </> : <button type="button" className="refresh" onClick={() => { setError(''); wallet.connect(); }}>Connect Wallet</button>}
    </div>
    {wallet.state === 'connected' && !compatibility.matches && !hideChipnetUndeclaredNote && <small className="wallet-error" role="alert">{compatibility.reason.split('. ')[0]}.</small>}
    {(error || wallet.error) && <small className="wallet-error" role="alert">{error || wallet.error}</small>}
    {wallet.state === 'connecting' && wallet.uri && wallet.qrUri && <PairingDialog uri={wallet.uri} qrUri={wallet.qrUri} onClose={() => { void disconnect(); }}/>}
  </div>;
}
