/** Deliberate provider policy: see retained bad-diffbits evidence and restoration report. */
export const CHIPNET_ENDPOINTS=['wss://chipnet.imaginary.cash:50004','wss://chipnet.bch.ninja:50004'];
export function excludedChipnetProvider(endpoint:string){return new URL(endpoint).hostname==='electrum-chipnet.optnlabs.com';}
export function activeConflictPeers(network:string,peers:string[]){return network==='chipnet'?peers.filter(peer=>!excludedChipnetProvider(peer)):peers;}
