import {RelayClient, RelayStatus, RelayMsgAction, DEFAULT_RELAY_URLS, generateKeyExchangeCredentials, encodeKeyExchangeURI, hexToBin, type DappRelayOptions, type DappRelayResult, type RelayStatusCallback, type WalletReadyMessage} from '@wizardconnect/core';

export class InvalidWalletSession extends Error {}

/** Use public SDK primitives with one serialized connection loop. The SDK 0.2.5
 * initiateDappRelay connection-manager resets its loop guard on error and leaves
 * a paused retry loop alive after cleanup. Owning the loop avoids both behaviors.
 * DappConnectionManager still owns protocol, persistence, derivation and signing.
 */
export function createWalletRelay(callback: RelayStatusCallback, options: DappRelayOptions = {}): DappRelayResult & {transportReachable?:()=>boolean} {
  const saved = options.existingCredentials;
  if (saved && (!/^[a-f0-9]{64}$/i.test(saved.privateKey) || !/^[a-f0-9]{64}$/i.test(saved.walletPublicKey) || !/^[a-f0-9]{16}$/i.test(saved.secret))) throw new InvalidWalletSession('Invalid saved transport credentials');
  const generated = saved ? null : generateKeyExchangeCredentials();
  const client = new RelayClient({explicitRelayUrls:[...DEFAULT_RELAY_URLS],signerPrivateKey:hexToBin(saved?.privateKey ?? generated!.privateKey),pairedPublicKey:saved ? hexToBin(saved.walletPublicKey) : new Uint8Array(33)});
  const credentials = generated ?? {privateKey:saved!.privateKey,secret:saved!.secret,publicKey:client.getPublicKeyHex()};
  let pairedKey=saved?.walletPublicKey.toLowerCase(), stopped=false, connecting=false, callInFlight=false, reachable=false, attempt=0;
  let attemptDeadline: ReturnType<typeof setTimeout>|undefined;
  let retry: ReturnType<typeof setTimeout>|undefined;
  const status = (state: RelayStatus) => { if (!stopped) callback({client,status:state}); };
  const schedule = () => {
    if (stopped || connecting || callInFlight || retry || attempt >= 4) return;
    const delay=[0,2_000,6_000,14_000][attempt++];
    retry=setTimeout(()=>{retry=undefined; void connect();},delay);
  };
  const connect = async () => {
    if (stopped || connecting || callInFlight) return;
    connecting=true; callInFlight=true;
    // RelayClient.connect returns after subscribing, before EOSE/connection.
    // Keep the single-flight guard until its event or this bounded deadline.
    attemptDeadline=setTimeout(interrupted,7_000);
    try { await client.connect(); } catch { interrupted(); }
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
    attempt=0; // Only a wallet handshake resets the outage retry budget.
  };
  client.on('connection',connected);
  client.on('disconnect',interrupted);
  client.on('error',interrupted);
  client.on('message',message);
  const uri=encodeKeyExchangeURI(credentials.publicKey,credentials.secret);
  status(RelayStatus.reconnecting('Opening transport'));
  schedule();
  return {client,credentials,transportReachable:()=>reachable,events:client as unknown as DappRelayResult['events'],...uri,cleanup(){
    if (stopped) return;
    stopped=true;reachable=false;clearTimeout(retry);clearTimeout(attemptDeadline);
    client.removeAllListeners();
    void client.disconnect().catch(()=>{});
  }};
}
