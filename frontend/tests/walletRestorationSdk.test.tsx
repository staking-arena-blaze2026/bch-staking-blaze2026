import {act,render,screen} from '@testing-library/react';
import {StrictMode} from 'react';
import {expect,it,vi} from 'vitest';
import {RelayClient,RelayMsgAction,PROTOCOL_NAME,hexToBin,type DappReadyMessage} from '@wizardconnect/core';
import {WALLET_SESSION_KEY,usePersistentWallet} from '../src/usePersistentWallet';

const service=vi.hoisted(()=>({interrupt:(_recipient:string)=>{}}));

// Replace only the remote Nostr service. Real SDK readiness, encryption, peer
// authentication, timestamp filtering, handshake manager and persistence run.
vi.mock('nostr-tools/pool',()=>{
 type Subscription={recipient:string;onevent:(event:unknown)=>void;oneose:()=>void;onclose:(reasons:string[])=>void};
 const subscriptions=new Set<Subscription>();
 service.interrupt=recipient=>{for(const sub of subscriptions)if(sub.recipient===recipient)sub.onclose(['temporary outage']);};
 return {useWebSocketImplementation:()=>{},SimplePool:class {
  subscribeMany(_urls:unknown,filter:{'#p':string[]},callbacks:Omit<Subscription,'recipient'>){
   const sub={recipient:filter['#p'][0],...callbacks};subscriptions.add(sub);
   const timer=setTimeout(()=>sub.oneose(),20);
   return {close:()=>{clearTimeout(timer);subscriptions.delete(sub);}};
  }
  publish(_urls:unknown,event:{tags:string[][]}){
   queueMicrotask(()=>{for(const sub of subscriptions)if(event.tags.some(tag=>tag[0]==='p'&&tag[1]===sub.recipient))sub.onevent(event);});
   return [Promise.resolve()];
  }
  close(){}
 }};
});

function Status(){const wallet=usePersistentWallet();return <span>{wallet.state}</span>;}

it('restores the same encrypted SDK pairing automatically when the wallet starts after the old deadline, then reopens again',async()=>{
 vi.useFakeTimers();
 const wallet=new RelayClient({signerPrivateKey:hexToBin('02'.repeat(32)),pairedPublicKey:new Uint8Array(33),explicitRelayUrls:['wss://test'],logNetworkActivity:false});
 const saved={privateKey:'01'.repeat(32),secret:'ab'.repeat(8),walletPublicKey:wallet.getPublicKeyHex()};
 localStorage.setItem(WALLET_SESSION_KEY,JSON.stringify(saved));
 const first=render(<StrictMode><Status/></StrictMode>);
 try {
  await act(async()=>{await vi.advanceTimersByTimeAsync(65_000);});
  expect(screen.getByText('offline')).toBeVisible();
  // Cashonize remains paired; it now comes online with the same keys. Respond
  // using the protocol rule for a reopened dapp (wallet_discovered=false).
  const temporary=new RelayClient({signerPrivateKey:hexToBin(saved.privateKey),pairedPublicKey:new Uint8Array(33),explicitRelayUrls:[],logNetworkActivity:false});
  wallet.setPairedPublicKey(hexToBin(temporary.getPublicKeyHex()));
  const received:string[]=[];
  wallet.on('message',message=>{
   received.push(message.action);
   if(message.action===RelayMsgAction.DappReady && !(message as DappReadyMessage).wallet_discovered)void wallet.relay({
    action:RelayMsgAction.WalletReady,time:Math.floor(Date.now()/1000),
    public_key:wallet.getPublicKeyHex(),secret:saved.secret,wallet_name:'Cashonize',wallet_icon:'',
    supported_protocols:[PROTOCOL_NAME],dapp_discovered:true,session:{[PROTOCOL_NAME]:{paths:[]}},
   } as Parameters<typeof wallet.relay>[0]);
  });
  await wallet.connect();
  await act(async()=>{await vi.advanceTimersByTimeAsync(25_000);});
  expect(screen.getByText('connected')).toBeVisible();
  await act(async()=>{service.interrupt(temporary.getPublicKeyHex());await vi.advanceTimersByTimeAsync(20_000);});
  expect(screen.getByText('connected')).toBeVisible();
  first.unmount();await act(async()=>{});
  const reopened=render(<StrictMode><Status/></StrictMode>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1_000);});
  expect(screen.getByText('connected')).toBeVisible();
  expect(JSON.parse(localStorage.getItem(WALLET_SESSION_KEY)!)).toMatchObject(saved);
  expect(received).not.toContain(RelayMsgAction.SignTransactionRequest);
  reopened.unmount();await act(async()=>{});
 } finally {first.unmount();await wallet.disconnect();vi.useRealTimers();}
},20_000);
