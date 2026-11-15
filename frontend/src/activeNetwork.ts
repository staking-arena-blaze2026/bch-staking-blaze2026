import type {V3Network} from '../../src/v3/network';
/** URL-scoped selection works in pages and dedicated workers, without shared mutable storage. */
export function selectedNetwork(env:Record<string,string|undefined>=import.meta.env,search=globalThis.location?.search??''):V3Network {
 const value=new URLSearchParams(search).get('network')??env.VITE_V3_NETWORK??'mainnet';
 if(!['mainnet','chipnet','regtest'].includes(value))throw Error('Unsupported network');
 if(value==='regtest'&&env.VITE_V3_NETWORK!=='regtest')throw Error('Regtest requires an explicit development build');
 return value as V3Network;
}
export const activeNetwork=selectedNetwork();
export let networkLeaving=false;
export function switchNetwork(network:'mainnet'|'chipnet') {
 if(network===activeNetwork)return;
 networkLeaving=true;
 window.dispatchEvent(new Event('arena-network-leaving'));
 const url=new URL(window.location.href);url.searchParams.set('network',network);url.hash='/v3/offers';
 window.location.assign(url);
}
