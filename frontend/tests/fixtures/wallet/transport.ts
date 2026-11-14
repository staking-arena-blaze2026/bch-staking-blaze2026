export {InvalidWalletSession} from '../../../src/walletRelay';
// Browser tests replace only the encrypted transport. Production SDK manager,
// persistence, React effects, UI and wallet worker code remain in use.
import {RelayClient, RelayStatus, RelayMsgAction, PROTOCOL_NAME, type DappRelayResult, type RelayStatusCallback} from '@wizardconnect/core';
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey} from '@bitauth/libauth';
const encoded=encodeHdPublicKey({node:deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88))),network:'testnet'});
if(typeof encoded==='string')throw Error(encoded);
const paths=[{name:'receive',xpub:encoded.hdPublicKey}];
const stats={attempts:0,pairings:0,cleanups:0,signatures:0,restored:[] as string[]};
let current: {ready:()=>void;interrupt:()=>void;revoke:()=>void}|undefined;
Object.assign(window,{walletTransport:{stats,ready:()=>current?.ready(),interrupt:()=>current?.interrupt(),revoke:()=>current?.revoke()}});
export function createWalletRelay(callback:RelayStatusCallback,options:any={}):DappRelayResult {
  stats.attempts++;
  const saved=options.existingCredentials;
  if(!saved)stats.pairings++;else stats.restored.push(saved.walletPublicKey);
  const client=new RelayClient({explicitRelayUrls:[],signerPrivateKey:new Uint8Array(32).fill(1)});
  let closed=false;
  client.isConnected=()=>!closed;
  client.isKeyExchangeComplete=()=>true;
  client.relay=async(message:any)=>{if(message.action===RelayMsgAction.SignTransactionRequest){stats.signatures++;throw Error('Browser persistence tests prohibit signing');}};
  const ready=()=>{
    if(closed)return;
    callback({client,status:RelayStatus.connected()});
    if(!saved)client.emit('keyexchangecomplete',new Uint8Array(32).fill(2));
    client.emit('message',{action:RelayMsgAction.WalletReady,wallet_name:'Cashonize',wallet_icon:'',dapp_discovered:true,supported_protocols:[PROTOCOL_NAME],session:{[PROTOCOL_NAME]:{paths}}});
  };
  current={ready,interrupt:()=>callback({client,status:RelayStatus.reconnecting('simulated interruption')}),revoke:()=>client.emit('message',{action:RelayMsgAction.Disconnect,reason:'user_disconnect'})};
  if(saved && localStorage.getItem('test-wallet-online')==='yes')setTimeout(ready,30);
  return {client,events:client as unknown as DappRelayResult['events'],credentials:{privateKey:saved?.privateKey??'01'.repeat(32),publicKey:'03'.repeat(32),secret:saved?.secret??'synthetic-transport-secret'},uri:'wiz://synthetic-test-pairing',qrUri:'WIZ://SYNTHETIC-TEST-PAIRING',cleanup(){if(!closed){closed=true;stats.cleanups++;client.removeAllListeners();}}};
}
