/** Public chain verification only. This script has no wallet, keys, or broadcast permission. */
import {writeFile} from 'node:fs/promises';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {verifiedProviders} from '../src/verified-providers.js';
import {walletPeers} from '../src/electrum-wallet.js';
const p=new BrowserElectrumProvider({network:'mainnet',endpoints:['wss://bch.loping.net:50004','wss://bch.imaginary.cash:50004'],allowBroadcast:false});
const observations:unknown[]=[];
const result=await verifiedProviders(p,walletPeers(p),async()=>{const tip=await p.tip(),checkpoint=await p.header(792773);observations.push({endpoint:p.endpoint,tip,checkpoint});return {tip,value:{height:tip.height,hash:tip.hash},identity:tip.hash};});
await writeFile('docs/blaze2026/mainnet-readonly.json',JSON.stringify({checkedAt:new Date().toISOString(),network:'mainnet',broadcasts:0,walletConnected:false,result,observations,limits:'Electrum header and provider consistency verification; not independent full-node consensus validation or live wallet workflow evidence.'},null,2)+'\n');
console.log('Verified mainnet read-only provider agreement',result);
