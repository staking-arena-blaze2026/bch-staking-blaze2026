import {binToHex,decodeHdPublicKey,deriveHdPublicNodeChild} from '@bitauth/libauth';
import type {WalletKey} from '../../src/transactions-core';
import type {PublicPath} from './walletNetwork';
export const walletChains=[['receive',0],['change',1],['defi',7]] as const;
/** Compare against the live chain-level xpub, never an assumed account path. */
export function checkedWalletKey(paths:readonly PublicPath[],path:WalletKey['path'],index:number,read:(child:number,index:bigint)=>Uint8Array|undefined):WalletKey {
 const descriptor=paths.find(p=>p.name===path),child=walletChains.find(c=>c[0]===path)![1];
 if(!descriptor||paths.filter(p=>p.name===path).length!==1||!Number.isSafeInteger(index)||index<0||index>=200)throw Error('Wallet address derivation does not match the connected Cashonize session. Reconnect the intended HD wallet.');
 const decoded=decodeHdPublicKey(descriptor.xpub);
 if(typeof decoded==='string'||decoded.network!=='testnet')throw Error('A valid chipnet/testnet wallet public derivation is required.');
 const expected=deriveHdPublicNodeChild(decoded.node,index),actual=read(child,BigInt(index));
 if(typeof expected==='string'||!actual||binToHex(actual)!==binToHex(expected.publicKey))throw Error('Wallet address derivation does not match the connected Cashonize session. Reconnect the intended HD wallet.');
 return {path,index,publicKey:binToHex(actual)};
}
