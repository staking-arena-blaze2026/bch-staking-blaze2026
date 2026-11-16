/** Opt-in interoperability check: synthetic paired wallet, actual wallet SDK and public relays. Never signs. */
import {render,screen,waitFor,act,fireEvent} from '@testing-library/react';
import {StrictMode} from 'react';
import {expect,it,vi} from 'vitest';
import {WalletConnectionManager,type WalletAdapter} from '@wizardconnect/wallet';
import {RelayClient,generateKeyExchangeCredentials,encodeKeyExchangeURI,hexToBin,DEFAULT_RELAY_URLS} from '@wizardconnect/core';
import {deriveHdPrivateNodeFromSeed,deriveHdPrivateNodeChild,deriveHdPublicNode,encodeHdPublicKey,secp256k1} from '@bitauth/libauth';
import {usePersistentWallet,WALLET_SESSION_KEY} from '../src/usePersistentWallet';
function Status(){const wallet=usePersistentWallet();return <><span>{wallet.state}</span><button onClick={wallet.retry}>Retry</button></>;}
const live=process.env.BLAZE_LIVE_RELAY==='1'?it:it.skip;
live('restores a synthetic pairing against Cashonize’s actual wallet manager over public Nostr relays',async()=>{
 const keys=generateKeyExchangeCredentials(),walletKeys=generateKeyExchangeCredentials();
 const root=deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(99));
 const adapter:WalletAdapter={walletName:'Synthetic interoperability fixture',walletIcon:'',getRelayPrivateKey:()=>hexToBin(walletKeys.privateKey),getPublicKey:()=>{const key=secp256k1.derivePublicKeyCompressed(root.privateKey);if(typeof key==='string')throw Error(key);return key;},getXpub:path=>{const encoded=encodeHdPublicKey({node:deriveHdPublicNode(deriveHdPrivateNodeChild(root,path)),network:'mainnet'});if(typeof encoded==='string')throw Error(encoded);return encoded.hdPublicKey;},signTransaction:vi.fn(async()=>{throw Error('Signing forbidden in interoperability check');})};
 const walletIdentity=new RelayClient({explicitRelayUrls:[],signerPrivateKey:hexToBin(walletKeys.privateKey),logNetworkActivity:false});
 localStorage.setItem(WALLET_SESSION_KEY,JSON.stringify({privateKey:keys.privateKey,secret:keys.secret,walletPublicKey:walletIdentity.getPublicKeyHex()}));
 const manager=new WalletConnectionManager(adapter);
 const pending=vi.fn();manager.on('pendingSignRequest',pending);
 const diagnostics:string[]=[];const log=vi.spyOn(console,'info').mockImplementation((...args)=>{const text=String(args[0]);if(text.startsWith('[Arena wallet'))diagnostics.push(text);});
 // Wallet SDK network logging includes synthetic keys; suppress it even for fixtures.
 vi.spyOn(console,'debug').mockImplementation(()=>{});vi.spyOn(console,'log').mockImplementation(()=>{});
 manager.connect(encodeKeyExchangeURI(keys.publicKey,keys.secret).uri);
 let view=render(<StrictMode><Status/></StrictMode>);const start=performance.now();let initialMs=0,reactivationMs=0;
 try{
  await waitFor(()=>expect(screen.getByText('connected')).toBeVisible(),{timeout:45_000});
  initialMs=performance.now()-start;
  view.unmount();await act(async()=>{});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(()=>expect(Object.values(manager.getConnections())[0].status.status).toBe('disconnected'));
  view=render(<StrictMode><Status/></StrictMode>);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1000));});
  expect(screen.queryByText('connected')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1000));});
  expect(screen.queryByText('connected')).toBeNull();
  // A background Cashonize browser tab deliberately suspends its relay, even
  // though the wallet still retains and displays the authorized pairing.
  const visibleAt=performance.now();
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(()=>expect(screen.getByText('connected')).toBeVisible(),{timeout:20_000});
  reactivationMs=performance.now()-visibleAt;
  expect(pending).not.toHaveBeenCalled();expect(adapter.signTransaction).not.toHaveBeenCalled();
 }finally{
  log.mockRestore();console.info(JSON.stringify({fixture:'actual wallet SDK, synthetic identity, public relays',milliseconds:performance.now()-start,initialMs,reactivationMs,diagnostics,relayCount:DEFAULT_RELAY_URLS.length}));
  view.unmount();await act(async()=>{});manager.disconnectAll();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await new Promise(resolve=>setTimeout(resolve,3000));
 }
},60_000);
