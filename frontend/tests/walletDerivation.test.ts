import {expect,it} from 'vitest';
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,deriveHdPublicNodeChild,encodeHdPublicKey,binToHex,hash160,cashAddressToLockingBytecode,encodeCashAddress} from '@bitauth/libauth';
import {checkedWalletKey,walletChains} from '../src/walletDerivation';
import {walletScript} from '../../src/transactions-core';
const nodes=walletChains.map((_,i)=>deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(80+i))));
const paths=walletChains.map(([name],i)=>{const e=encodeHdPublicKey({node:nodes[i]!,network:'testnet'});if(typeof e==='string')throw Error(e);return {name,xpub:e.hdPublicKey};});
const read=(child:number,index:bigint)=>{const n=nodes[walletChains.findIndex(c=>c[1]===child)]!;const d=deriveHdPublicNodeChild(n,Number(index));if(typeof d==='string')throw Error(d);return d.publicKey;};
it('chain-level xpub derives receive/change/defi indices exactly once and P2PKH is CashAddr-compatible',()=>{
 for(const [path,child] of walletChains)for(const index of [0,1,39,199]){const k=checkedWalletKey(paths,path,index,read),key=read(child,BigInt(index));expect(k.publicKey).toBe(binToHex(key));const addr=encodeCashAddress({prefix:'bchtest',type:'p2pkh',payload:hash160(key)});if(typeof addr==='string')throw Error(addr);const decoded=cashAddressToLockingBytecode(addr.address);if(typeof decoded==='string')throw Error(decoded);expect(walletScript(k.publicKey)).toBe(binToHex(decoded.bytecode));}
});
it('wrong SDK/account identity, absent path and non-chipnet key families are refused',()=>{
 expect(()=>checkedWalletKey(paths,'receive',0,()=>read(1,0n))).toThrow(/does not match/);
 expect(()=>checkedWalletKey(paths.filter(p=>p.name!=='receive'),'receive',0,read)).toThrow(/does not match/);
 const e=encodeHdPublicKey({node:nodes[0]!,network:'mainnet'});if(typeof e==='string')throw Error(e);expect(()=>checkedWalletKey([{name:'receive',xpub:e.hdPublicKey}],'receive',0,read)).toThrow(/chipnet/);
});

it('initial discovery derives only two addresses per advertised chain',()=>{
 let count=0;for(let index=0;index<2;index++)for(const [path] of walletChains)checkedWalletKey(paths,path,index,(c,i)=>{count++;return read(c,i);});expect(count).toBe(6);
});
