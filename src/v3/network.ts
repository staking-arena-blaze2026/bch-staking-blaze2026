import {Network,type NetworkProvider} from 'cashscript';
export type V3Network='mainnet'|'chipnet'|'regtest';
/** No generic testnet fallback: all supported public chains have pinned Electrum identities. */
export function v3Network(provider:Pick<NetworkProvider,'network'>):V3Network {
 if(provider.network===Network.MAINNET)return 'mainnet';
 if(provider.network===Network.CHIPNET)return 'chipnet';
 if(provider.network===Network.REGTEST)return 'regtest';
 throw Error('Unsupported V3 network');
}
export function v3Storage(kind:'wallet'|'claims'|'configs',network:V3Network){
 if(!['mainnet','chipnet','regtest'].includes(network))throw Error('Unsupported v3 storage network');
 // Keep existing regtest journals recoverable. Never import them into chipnet.
 return `staking-arena-${kind==='configs'?'v3-configs':kind+'-v3'}${network==='regtest'?'':'-'+network}`;
}

/** Untagged historical records predate mainnet support and belong only to their old stores. */
export function assertStoredNetwork(record:{network?:V3Network},network:V3Network){
 if(record.network!==network&&(record.network!==undefined||network==='mainnet'))throw Error('Journal network mismatch; original record retained');
}
