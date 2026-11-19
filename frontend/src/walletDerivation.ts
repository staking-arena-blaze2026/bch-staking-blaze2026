import {binToHex,decodeHdPublicKey,deriveHdPublicNodeChild} from '@bitauth/libauth';
import type {WalletKey} from '../../src/transactions-core';
import type {PublicPath} from './walletNetwork';
export const walletChains=[['receive',0],['change',1],['defi',7]] as const;
/** Derive a public child of the advertised chain-level xpub for a watch-only scan. */
export function deriveWalletKey(paths:readonly PublicPath[],path:WalletKey['path'],index:number,network:'mainnet'|'testnet'='testnet'):WalletKey {
 const descriptor=paths.find(p=>p.name===path);
 if(!descriptor||paths.filter(p=>p.name===path).length!==1||!Number.isSafeInteger(index)||index<0||index>=200)throw Error('Wallet address derivation does not match the connected Cashonize session. Reconnect the intended HD wallet.');
 const decoded=decodeHdPublicKey(descriptor.xpub);
 if(typeof decoded==='string'||decoded.network!==network)throw Error('A valid '+(network==='mainnet'?'mainnet':'chipnet/testnet')+' wallet public derivation is required.');
 const expected=deriveHdPublicNodeChild(decoded.node,index);
 if(typeof expected==='string')throw Error('Cannot derive the requested wallet public key.');
 return {path,index,publicKey:binToHex(expected.publicKey)};
}

/** At a live boundary, also verify that the SDK assigns this path the same key. */
export function checkedWalletKey(paths:readonly PublicPath[],path:WalletKey['path'],index:number,read:(child:number,index:bigint)=>Uint8Array|undefined,network:'mainnet'|'testnet'='testnet'):WalletKey {
 const key=deriveWalletKey(paths,path,index,network);
 const child=walletChains.find(c=>c[0]===path)![1],actual=read(child,BigInt(index));
 if(!actual||binToHex(actual)!==key.publicKey)throw Error('Wallet address derivation does not match the connected Cashonize session. Reconnect the intended HD wallet.');
 return key;
}
