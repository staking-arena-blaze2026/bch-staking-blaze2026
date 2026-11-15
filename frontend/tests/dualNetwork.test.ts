import {expect,it,vi} from 'vitest';
import {Network,MockNetworkProvider} from 'cashscript';
import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey,hexToBin} from '@bitauth/libauth';
import {selectedNetwork} from '../src/activeNetwork';
import {ElectrumCore} from '../../src/electrum-core';
import {ownerAddress,family} from '../../src/v3/protocol';
import {v3Storage,assertStoredNetwork} from '../../src/v3/network';
import {walletAddress} from '../../src/transactions-core';
import {assertTransactionSession,WalletNetworkSession,MAINNET_NETWORK,CHIPNET_NETWORK,NETWORK_EXTENSION} from '../src/walletNetwork';
it('defaults to mainnet, allows chipnet URL selection, and restricts regtest to development builds',()=>{
 expect(selectedNetwork({},'')).toBe('mainnet');expect(selectedNetwork({},'?network=chipnet')).toBe('chipnet');
 expect(()=>selectedNetwork({},'?network=regtest')).toThrow();expect(selectedNetwork({VITE_V3_NETWORK:'regtest'},'?network=regtest')).toBe('regtest');expect(()=>selectedNetwork({},'?network=testnet4')).toThrow();
});
it('keeps all old storage names and gives mainnet separate journals, claims and configurations',()=>{
 for(const kind of ['wallet','claims','configs'] as const)expect(new Set(['mainnet','chipnet','regtest'].map(n=>v3Storage(kind,n as any))).size).toBe(3);
 expect(v3Storage('wallet','chipnet')).toBe('staking-arena-wallet-v3-chipnet');expect(v3Storage('wallet','regtest')).toBe('staking-arena-wallet-v3');
});
it('requires a live matching mainnet wallet and always blocks chipnet transactions',()=>{
 const node=deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(9)));
 const paths=(network:'mainnet'|'testnet')=>{const key=encodeHdPublicKey({node,network});if(typeof key==='string')throw Error(key);return [{name:'receive',xpub:key.hdPublicKey}];};
 let current=paths('mainnet');const session=new WalletNetworkSession(()=>current);
 expect(()=>assertTransactionSession(session,MAINNET_NETWORK)).toThrow();session.accept();expect(()=>assertTransactionSession(session,MAINNET_NETWORK)).not.toThrow();
 expect(()=>assertTransactionSession(session,CHIPNET_NETWORK)).toThrow(/temporarily unavailable/);
 current=paths('testnet');session.accept();expect(()=>assertTransactionSession(session,MAINNET_NETWORK)).toThrow();
 current=paths('mainnet');session.accept({[NETWORK_EXTENSION]:{network:'mainnet',genesisHash:'11'.repeat(32)}});expect(()=>assertTransactionSession(session,MAINNET_NETWORK)).toThrow(/different chain/);
 session.invalidate();expect(()=>assertTransactionSession(session,MAINNET_NETWORK)).toThrow();
});
it('generates network-specific wallet, covenant and discovery addresses',()=>{
 const key=hexToBin('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),p=new MockNetworkProvider();
 const config={version:3 as const,registryVersion:4 as const,stakingAsset:{kind:'bch' as const},rewardAsset:{kind:'bch' as const},epoch:1800000000,periodSeconds:3600,periods:4,cap:2000n};
 for(const network of [Network.MAINNET,Network.CHIPNET,Network.REGTEST]){p.network=network;const prefix=network===Network.MAINNET?'bitcoincash':network===Network.CHIPNET?'bchtest':'bchreg';expect(ownerAddress(key,p)).toMatch(new RegExp('^'+prefix+':'));expect(family(config,'11'.repeat(32),p).registry.address).toMatch(new RegExp('^'+prefix+':'));expect(walletAddress(key,network as any)).toMatch(new RegExp('^'+prefix+':'));}
});
it('pins mainnet genesis and a BCH-specific post-fork checkpoint before running any work',async()=>{
 const connection={connect:async()=>{},close:()=>{},request:async()=>['fixture','1.5']};
 const p=new ElectrumCore(()=>connection,{network:'mainnet',endpoints:['wss://fixture.test']}),work=vi.fn(async()=>true);
 const header=vi.spyOn(p,'header').mockImplementation(async height=>({height,hash:height===0?MAINNET_NETWORK.genesisHash:'00'.repeat(32)} as any));
 await expect(p.session(work)).rejects.toThrow(/mainnet identity mismatch/);expect(work).not.toHaveBeenCalled();
 header.mockImplementation(async height=>({height,hash:height===0?MAINNET_NETWORK.genesisHash:'000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8'} as any));
 await expect(p.session(work)).resolves.toBe(true);expect(header).toHaveBeenCalledWith(792773);
});
it('rejects cross-network addresses and blocks every chipnet broadcast even with allowBroadcast',async()=>{
 const key=hexToBin('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
 const p=new ElectrumCore(()=>{throw Error('No transport expected')},{network:'mainnet'});vi.spyOn(p,'getUtxosForLockingBytecode').mockResolvedValue([]);
 await expect(p.getUtxos(walletAddress(key,'chipnet'))).rejects.toThrow(/network mismatch/);await expect(p.getUtxos(walletAddress(key,'mainnet'))).resolves.toEqual([]);
 const chipnet=new ElectrumCore(()=>{throw Error('No transport expected')},{network:'chipnet',allowBroadcast:true});await expect(chipnet.sendRawTransaction('00')).rejects.toThrow(/temporarily unavailable/);
 await expect(p.sendRawTransaction('00')).rejects.toThrow(/disabled/);
});

it('refuses transplanted signed journals, accepting untagged historical records only in old stores',()=>{
 expect(()=>assertStoredNetwork({network:'chipnet'},'mainnet')).toThrow(/network mismatch/);
 expect(()=>assertStoredNetwork({network:'mainnet'},'chipnet')).toThrow(/network mismatch/);
 expect(()=>assertStoredNetwork({},'mainnet')).toThrow();expect(()=>assertStoredNetwork({},'chipnet')).not.toThrow();expect(()=>assertStoredNetwork({},'regtest')).not.toThrow();
});
