import type {ElectrumOptions} from '../../src/electrum-core';
import {selectedNetwork} from './activeNetwork';
import {v3Storage} from '../../src/v3/network';
/** Public builds default to mainnet. Local regtest requires an explicit build-time selection. */
export function v3Config(env:Record<string,string|undefined>=import.meta.env):ElectrumOptions & {network:'mainnet'|'chipnet'|'regtest'} {
 const network=selectedNetwork(env);
 const endpoints=(network==='regtest'?env.VITE_V3_REGTEST_ENDPOINTS??'wss://127.0.0.1:4177,wss://localhost:4177':network==='mainnet'?env.VITE_MAINNET_ELECTRUM_ENDPOINTS??'wss://bch.loping.net:50004,wss://bch.imaginary.cash:50004':env.VITE_CHIPNET_ELECTRUM_ENDPOINTS??env.VITE_ELECTRUM_ENDPOINTS??'wss://chipnet.imaginary.cash:50004,wss://electrum-chipnet.optnlabs.com,wss://chipnet.bch.ninja:50004').split(',').map(s=>s.trim());
 for(const endpoint of endpoints){const u=new URL(endpoint);if(u.protocol!=='wss:'||u.username||u.password||u.hash||u.search)throw Error('V3 requires credential-free WSS endpoints');if(network==='regtest'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('V3 regtest endpoints must be local');}
 if(endpoints.length>4||new Set(endpoints.map(e=>new URL(e).hostname)).size<2)throw Error('V3 requires two different Electrum provider hosts');
 return {network,endpoints,allowBroadcast:network!=='chipnet',...(network==='regtest'?{maxTipAgeSeconds:2147483647}:{})};
}
export const v3Chain=v3Config().network;
export const v3ConfigStorage=v3Storage('configs',v3Chain);
