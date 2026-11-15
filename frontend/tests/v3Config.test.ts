import {expect,it} from 'vitest';
import {v3Config} from '../src/v3Config';
import {v3Storage} from '../../src/v3/network';
it('published v3 uses mainnet freshness limits and independent public WSS providers',()=>{
 const c=v3Config({});expect(c.network).toBe('mainnet');expect(c.maxTipAgeSeconds).toBeUndefined();expect(c.allowBroadcast).toBe(true);expect(new Set(c.endpoints!.map(e=>new URL(e).hostname)).size).toBeGreaterThanOrEqual(2);
 expect(v3Storage('configs','chipnet')).not.toBe(v3Storage('configs','regtest'));
});
it('generic testnet, duplicate providers, credentials and remote regtest are rejected',()=>{
 for(const env of [{VITE_V3_NETWORK:'testnet4'},{VITE_MAINNET_ELECTRUM_ENDPOINTS:'wss://one.test,wss://one.test:50004'},{VITE_MAINNET_ELECTRUM_ENDPOINTS:'ws://one.test,wss://two.test'},{VITE_MAINNET_ELECTRUM_ENDPOINTS:'wss://user:secret@one.test,wss://two.test'},{VITE_V3_NETWORK:'regtest',VITE_V3_REGTEST_ENDPOINTS:'wss://remote.test,wss://localhost'}])expect(()=>v3Config(env)).toThrow();
 const c=v3Config({VITE_V3_NETWORK:'regtest'});expect(c.network).toBe('regtest');expect(c.endpoints).toEqual(['wss://127.0.0.1:4177','wss://localhost:4177']);
});

it('chipnet remains configured with broadcasting disabled and preserved journal names',()=>{const c=v3Config({VITE_V3_NETWORK:'chipnet'});expect(c.allowBroadcast).toBe(false);expect(v3Storage('configs','chipnet')).toBe('staking-arena-v3-configs-chipnet');expect(v3Storage('wallet','mainnet')).not.toBe(v3Storage('wallet','chipnet'));});
