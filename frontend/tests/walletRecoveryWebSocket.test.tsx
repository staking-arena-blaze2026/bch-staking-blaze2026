import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {expect,it,vi} from 'vitest';
import {WebSocketServer} from 'ws';
import {RelayClient,RelayMsgAction,PROTOCOL_NAME,hexToBin,type DappReadyMessage} from '@wizardconnect/core';
import {WALLET_SESSION_KEY,usePersistentWallet} from '../src/usePersistentWallet';
const relay=vi.hoisted(()=>({url:''}));
// Only redirect the public relay URL: actual WebSockets, Nostr subscription/ACK,
// encryption, replay filtering and SDK manager all run on wall-clock time.
vi.mock('@wizardconnect/core',async original=>{
 const sdk=await original<typeof import('@wizardconnect/core')>();
 return {...sdk,RelayClient:class extends sdk.RelayClient {
  constructor(config:ConstructorParameters<typeof sdk.RelayClient>[0]){super({...config,explicitRelayUrls:[relay.url]});}
 }};
});
function Status(){const wallet=usePersistentWallet();return <><span>{wallet.state}</span><button onClick={wallet.retry}>Retry</button></>;}
it.each(['manual','automatic'])('recovers a lost subscription over real WebSockets with %s recovery',async mode=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const port=(server.address() as {port:number}).port;relay.url=`ws://127.0.0.1:${port}`;
 const subscribers=new Map<any,Map<string,string>>();let requests=0,dropRecipient='';
 server.on('connection',socket=>{
  const subs=new Map<string,string>();subscribers.set(socket,subs);
  socket.on('close',()=>subscribers.delete(socket));
  socket.on('message',bytes=>{
   const message=JSON.parse(String(bytes));
   if(message[0]==='REQ'){
    requests++;const recipient=message[2]['#p'][0];
    // Reproduce an apparently ready connection whose subscription delivers no events.
    if(recipient!==dropRecipient)subs.set(message[1],recipient);
    socket.send(JSON.stringify(['EOSE',message[1]]));
   }else if(message[0]==='CLOSE')subs.delete(message[1]);
   else if(message[0]==='EVENT'){
    const event=message[1];socket.send(JSON.stringify(['OK',event.id,true,'']));
    for(const [peer,subscriptions]of subscribers)for(const [id,recipient]of subscriptions)if(event.tags.some((tag:string[])=>tag[0]==='p'&&tag[1]===recipient))peer.send(JSON.stringify(['EVENT',id,event]));
   }
  });
 });
 const wallet=new RelayClient({signerPrivateKey:hexToBin('0b'.repeat(32)),pairedPublicKey:new Uint8Array(33),explicitRelayUrls:[relay.url],logNetworkActivity:false});
 const dapp=new RelayClient({signerPrivateKey:hexToBin('0c'.repeat(32)),pairedPublicKey:new Uint8Array(33),explicitRelayUrls:[relay.url],logNetworkActivity:false});
 dropRecipient=dapp.getPublicKeyHex();wallet.setPairedPublicKey(hexToBin(dropRecipient));
 const saved={privateKey:'0c'.repeat(32),secret:'ab'.repeat(8),walletPublicKey:wallet.getPublicKeyHex()};
 localStorage.setItem(WALLET_SESSION_KEY,JSON.stringify(saved));
 const actions:string[]=[];
 wallet.on('message',message=>{
  actions.push(message.action);
  if(message.action===RelayMsgAction.DappReady&&!(message as DappReadyMessage).wallet_discovered)void wallet.relay({action:RelayMsgAction.WalletReady,time:Math.floor(Date.now()/1000),public_key:wallet.getPublicKeyHex(),secret:saved.secret,wallet_name:'Cashonize fixture',wallet_icon:'',supported_protocols:[PROTOCOL_NAME],dapp_discovered:true,session:{[PROTOCOL_NAME]:{paths:[]}}} as Parameters<typeof wallet.relay>[0]);
 });
 await wallet.connect();
 const view=render(<StrictMode><Status/></StrictMode>);
 try{
  await waitFor(()=>expect(requests).toBeGreaterThanOrEqual(2));
  expect(screen.getByText('restoring')).toBeVisible();
  const before=requests,start=performance.now();dropRecipient='';
  if(mode==='manual')fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(screen.getByText('connected')).toBeVisible(),{timeout:20_000});
  const elapsed=performance.now()-start;
  console.info(`SDK_REAL_WEBSOCKET_${mode.toUpperCase()}_RECOVERY_MS ${elapsed.toFixed(1)}`);
  expect(requests).toBeGreaterThan(before);
  expect(JSON.parse(localStorage.getItem(WALLET_SESSION_KEY)!)).toMatchObject(saved);
  expect(actions).not.toContain(RelayMsgAction.SignTransactionRequest);
  if(mode==='manual')expect(elapsed).toBeLessThan(5_000);
 }finally{
  view.unmount();await act(async()=>{});await wallet.disconnect();
  for(const socket of server.clients)socket.terminate();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
},30_000);
