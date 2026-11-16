import {RelayClient, RelayStatus, RelayMsgAction, DEFAULT_RELAY_URLS, generateKeyExchangeCredentials, encodeKeyExchangeURI, hexToBin, type DappRelayOptions, type DappRelayResult, type RelayStatusCallback, type WalletReadyMessage, type DappReadyMessage} from '@wizardconnect/core';

export class InvalidWalletSession extends Error {}

/** Use public SDK primitives with one serialized connection loop. The SDK 0.2.5
 * initiateDappRelay connection-manager resets its loop guard on error and leaves
 * a paused retry loop alive after cleanup. Owning the loop avoids both behaviors.
 * DappConnectionManager still owns protocol, persistence, derivation and signing.
 */
export function createWalletRelay(callback: RelayStatusCallback, options: DappRelayOptions = {}): DappRelayResult & {transportReachable?:()=>boolean;recover?:(refreshSubscription?:boolean)=>void;prepareHandshake?:()=>void} {
  const saved = options.existingCredentials;
  if (saved && (!/^[a-f0-9]{64}$/i.test(saved.privateKey) || !/^[a-f0-9]{64}$/i.test(saved.walletPublicKey) || !/^[a-f0-9]{16}$/i.test(saved.secret))) throw new InvalidWalletSession('Invalid saved transport credentials');
  const generated = saved ? null : generateKeyExchangeCredentials();
  const client = new RelayClient({logNetworkActivity:false,explicitRelayUrls:[...DEFAULT_RELAY_URLS],signerPrivateKey:hexToBin(saved?.privateKey ?? generated!.privateKey),pairedPublicKey:saved ? hexToBin(saved.walletPublicKey) : new Uint8Array(33)});
  const credentials = generated ?? {privateKey:saved!.privateKey,secret:saved!.secret,publicKey:client.getPublicKeyHex()};
  let pairedKey=saved?.walletPublicKey.toLowerCase(), stopped=false, connecting=false, callInFlight=false, reachable=false, attempt=0;
  // SDK updateConnection starts an unawaitable asynchronous send. Coalesce
  // identical ready sends until publication settles. A reactive protocol-confirming
  // ready must follow a proactive ready, never be discarded. Never coalesce signs.
  const send = client.relay.bind(client);
  let readySend: ReturnType<typeof client.relay>|undefined;
  let readyDescription = '';
  let requestFreshWalletReady = false;
  let walletReplyDeadline: ReturnType<typeof setTimeout>|undefined;
  let silentRefreshes = 0;
  let lastRefresh = -Infinity;
  const clearWalletDeadline = () => { clearTimeout(walletReplyDeadline); walletReplyDeadline=undefined; };
  const prepareHandshake = () => {
    requestFreshWalletReady=true;
    if (stopped || walletReplyDeadline) return;
    walletReplyDeadline=setTimeout(()=>{
      walletReplyDeadline=undefined;
      console.info(`[Arena wallet +${Math.round(performance.now())}ms] Wallet reply absent; refreshing relay subscription`);
      recover(true);
    },Math.min(30_000,15_000 * 2 ** Math.min(silentRefreshes++,1)));
  };
  client.relay = message => {
    if (message.action !== RelayMsgAction.DappReady) return send(message);
    if (requestFreshWalletReady) {
      requestFreshWalletReady=false;
      const {selected_protocol: _selected, ...probe} = message as DappReadyMessage;
      message = {...probe,wallet_discovered:false} as DappReadyMessage;
    }
    const description = JSON.stringify({...message,time:undefined});
    if (readySend && readyDescription === description) return readySend;
    const pending = readySend
      ? readySend.catch(()=>{}).then(()=>stopped ? undefined : send(message))
      : stopped ? Promise.resolve() : send(message);
    readyDescription = description;
    readySend = pending;
    void pending.finally(() => { if (readySend === pending) readySend=undefined; }).catch(()=>{});
    return pending;
  };
  let attemptDeadline: ReturnType<typeof setTimeout>|undefined;
  let retry: ReturnType<typeof setTimeout>|undefined;
  const status = (state: RelayStatus) => { if (!stopped) callback({client,status:state}); };
  const schedule = () => {
    if (stopped || connecting || callInFlight || retry) return;
    const delay=attempt === 0 ? 0 : Math.min(30_000,2_000 * 2 ** Math.min(attempt-1,4));
    attempt++;
    retry=setTimeout(()=>{retry=undefined; void connect();},delay);
  };
  const connect = async () => {
    if (stopped || connecting || callInFlight) return;
    if (navigator.onLine === false) { schedule(); return; }
    connecting=true; callInFlight=true; reachable=false;
    clearWalletDeadline();
    status(RelayStatus.reconnecting('Refreshing transport'));
    // RelayClient.connect returns after subscribing, before EOSE/connection.
    // Keep the single-flight guard until its event or this bounded deadline.
    attemptDeadline=setTimeout(interrupted,7_000);
    try { await client.disconnect(); if (!stopped) await client.connect(); } catch { interrupted(); }
    finally { callInFlight=false; if (!connecting && !reachable) schedule(); }
  };
  const connected=()=>{clearTimeout(retry);retry=undefined;clearTimeout(attemptDeadline);connecting=false;reachable=true;status(RelayStatus.connected());};
  const interrupted=()=>{
    clearTimeout(attemptDeadline);connecting=false;reachable=false;
    status(RelayStatus.reconnecting('Transport interrupted'));
    schedule();
  };
  const message=(message: WalletReadyMessage)=>{
    if (message.action !== RelayMsgAction.WalletReady || stopped) return;
    if (!pairedKey) {
      if (message.secret !== credentials.secret || !/^[a-f0-9]{64}$/i.test(message.public_key)) { status(RelayStatus.sessionDeleted()); return; }
      pairedKey=message.public_key.toLowerCase();
      client.setPairedPublicKey(hexToBin(pairedKey));
      client.emit('keyexchangecomplete',hexToBin(pairedKey));
    } else if (message.public_key && message.public_key.toLowerCase() !== pairedKey) {
      status(RelayStatus.sessionDeleted()); return;
    }
    clearWalletDeadline(); silentRefreshes=0;
    attempt=0; // Only a wallet handshake resets outage backoff.
  };
  client.on('connection',connected);
  client.on('disconnect',interrupted);
  client.on('error',interrupted);
  client.on('message',message);
  const uri=encodeKeyExchangeURI(credentials.publicKey,credentials.secret);
  status(RelayStatus.reconnecting('Opening transport'));
  schedule();
  const recover = (refreshSubscription = false) => {
    if (stopped || (reachable && !refreshSubscription) || connecting || callInFlight || navigator.onLine === false) return;
    // Coalesce manual/focus/watchdog notifications without trusting a stale EOSE.
    if (Date.now()-lastRefresh < 2_000) return;
    lastRefresh=Date.now();
    clearTimeout(retry); retry=undefined; void connect();
  };
  return {client,credentials,prepareHandshake,transportReachable:()=>reachable,recover,events:client as unknown as DappRelayResult['events'],...uri,cleanup(){
    if (stopped) return;
    stopped=true;reachable=false;clearWalletDeadline();clearTimeout(retry);clearTimeout(attemptDeadline);
    client.removeAllListeners();
    void client.disconnect().catch(()=>{});
  }};
}
