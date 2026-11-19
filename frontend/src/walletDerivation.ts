import {binToHex,decodeHdPublicKey,deriveHdPublicNodeChild,sha256} from '@bitauth/libauth';
import type {WalletKey} from '../../src/transactions-core';
import type {PublicPath} from './walletNetwork';

export const walletChains=[['receive',0],['change',1],['defi',7]] as const;
const mismatch=()=>Error('Wallet address derivation does not match the authenticated Cashonize session. Reconnect the intended HD wallet.');
type KeyFamily='mainnet'|'testnet';
function publicNode(xpub:string,network:KeyFamily){
 const decoded=decodeHdPublicKey(xpub);
 if(typeof decoded==='string'||decoded.network!==network)throw Error('A valid '+(network==='mainnet'?'mainnet':'chipnet/testnet')+' wallet public derivation is required.');
 return decoded.node;
}
function publicChild(node:ReturnType<typeof publicNode>,path:WalletKey['path'],index:number):WalletKey{
 if(!Number.isSafeInteger(index)||index<0||index>=200)throw mismatch();
 const child=deriveHdPublicNodeChild(node,index);
 if(typeof child==='string')throw mismatch();
 return {path,index,publicKey:binToHex(child.publicKey)};
}

export function walletDiscoveryFingerprint(network:string,paths:readonly PublicPath[]){
 const ordered=paths.map(path=>[path.name,path.xpub]).sort(([a],[b])=>a!.localeCompare(b!));
 return binToHex(sha256.hash(new TextEncoder().encode(JSON.stringify([network,ordered]))));
}

/** Offline derivation uses only previously authenticated chain-level paths. */
export function publicWalletDeriver(paths:readonly PublicPath[],network:KeyFamily){
 const nodes=new Map<WalletKey['path'],ReturnType<typeof publicNode>>();
 for(const [path] of walletChains){
  const descriptors=paths.filter(p=>p.name===path);
  if(descriptors.length>1)throw mismatch();
  if(descriptors[0])nodes.set(path,publicNode(descriptors[0].xpub,network));
 }
 if(!nodes.has('receive'))throw mismatch();
 const children=new Map<string,WalletKey>();
 return (path:WalletKey['path'],index:number)=>{
  const node=nodes.get(path);
  if(!node)return;
  const id=path+':'+index,existing=children.get(id);
  if(existing)return existing;
  const key=publicChild(node,path,index);children.set(id,key);return key;
 };
}

/** Compare against the live SDK child and the authenticated chain-level xpub. */
export function checkedWalletKey(paths:readonly PublicPath[],path:WalletKey['path'],index:number,read:(child:number,index:bigint)=>Uint8Array|undefined,network:KeyFamily='testnet'):WalletKey {
 const descriptor=paths.find(p=>p.name===path),chain=walletChains.find(c=>c[0]===path);
 if(!descriptor||!chain||paths.filter(p=>p.name===path).length!==1)throw mismatch();
 const expected=publicChild(publicNode(descriptor.xpub,network),path,index),actual=read(chain[1],BigInt(index));
 if(!actual||binToHex(actual)!==expected.publicKey)throw mismatch();
 return expected;
}
