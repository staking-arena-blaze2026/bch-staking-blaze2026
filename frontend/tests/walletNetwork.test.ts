import { expect,it } from 'vitest';
import { deriveHdPrivateNodeFromSeed,deriveHdPublicNode,encodeHdPublicKey } from '@bitauth/libauth';
import { assertChipnetTransactionSession,CHIPNET_NETWORK,REGTEST_NETWORK,WalletNetworkSession,NETWORK_EXTENSION } from '../src/walletNetwork';
function paths(network:'mainnet'|'testnet') {
  const node=deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88)));
  const encoded=encodeHdPublicKey({node,network});
  if(typeof encoded==='string') throw Error(encoded);
  return [{name:'receive',xpub:encoded.hdPublicKey}];
}
it('rejects mainnet and cached or disconnected paths before chipnet signing',()=>{
  let current=paths('mainnet');
  const session=new WalletNetworkSession(()=>current);
  session.accept();expect(()=>assertChipnetTransactionSession(session,CHIPNET_NETWORK)).toThrow(/Mainnet/);
  current=paths('testnet');expect(()=>assertChipnetTransactionSession(session,CHIPNET_NETWORK)).toThrow(/live/);
  session.accept();expect(()=>assertChipnetTransactionSession(session,CHIPNET_NETWORK)).not.toThrow();
  expect(()=>assertChipnetTransactionSession(session,REGTEST_NETWORK)).toThrow();
  expect(()=>assertChipnetTransactionSession(session,{network:'chipnet',genesisHash:'00'.repeat(32)})).toThrow();
  session.invalidate();expect(()=>assertChipnetTransactionSession(session,CHIPNET_NETWORK)).toThrow(/live/);
});
it('never overrides an explicit conflicting wallet chain declaration',()=>{
  const session=new WalletNetworkSession(()=>paths('testnet'));
  session.accept({[NETWORK_EXTENSION]:{network:'testnet4',genesisHash:CHIPNET_NETWORK.genesisHash}});
  expect(()=>assertChipnetTransactionSession(session,CHIPNET_NETWORK)).toThrow();
});
