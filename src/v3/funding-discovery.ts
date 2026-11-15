import {verifiedProviders} from '../verified-providers.js';
import {ChainExtension,type ElectrumCore} from '../electrum-core.js';
import {coinIdentity,walletPeers} from '../electrum-wallet.js';
import {walletScript,type WalletKey,type WalletCoin} from '../transactions-core.js';

// Hints cache only public keys and recently observed outpoints, never authorization or balances.
// Every visited address is read afresh on both peers; zero-balance addresses remain searchable.
const hints=new WeakMap<ElectrumCore,Map<string,WalletCoin[]>>();
export async function discoverFunding(p:ElectrumCore,keys:WalletKey[],enough:(coins:WalletCoin[])=>boolean|Promise<boolean>,progress?:(message:string)=>void){
 if(!keys.length||keys.length>600||new Set(keys.map(k=>`${k.path}:${k.index}`)).size!==keys.length||keys.some(k=>!['receive','change','defi'].includes(k.path)||!Number.isInteger(k.index)||k.index<0||k.index>=200))throw Error('Invalid bounded wallet descriptor');
 const cache=hints.get(p)??new Map<string,WalletCoin[]>();hints.set(p,cache);
 const ordered=[...keys].sort((a,b)=>Number(!!cache.get(b.publicKey)?.length)-Number(!!cache.get(a.publicKey)?.length)||Number(!!b.fundingHint)-Number(!!a.fundingHint)||a.index-b.index||['receive','change','defi'].indexOf(a.path)-['receive','change','defi'].indexOf(b.path));
 const coins:WalletCoin[]=[],started=performance.now();let addresses=0;const queried:WalletKey[]=[];
 progress?.('Finding wallet funds…');
 for(let start=0;start<ordered.length;start+=6){
  const batch=ordered.slice(start,start+6);
  const first=await verifiedProviders(p,walletPeers(p),async()=>{
    const tip=await p.tip();
    const settled=await Promise.allSettled(batch.map(async key=>(await p.getUtxosForLockingBytecode(walletScript(key.publicKey))).map(utxo=>({...key,utxo}))));
    const rows:WalletCoin[]=[];for(const result of settled){if(result.status==='rejected')throw result.reason;rows.push(...result.value);}
    const moved=await p.classifyTipChange(tip);if(moved==='extension')throw new ChainExtension();if(moved==='reorg')throw Error('Reorganization during funding discovery');
    const value=rows.sort((a,b)=>coinIdentity(a.utxo).localeCompare(coinIdentity(b.utxo)));
    return {value,tip,identity:tip.hash+value.map(c=>coinIdentity(c.utxo)+':'+(c.utxo as {height?:number}).height).join('\n')};
  },{onProgress:progress});
  for(const key of batch)cache.set(key.publicKey,first!.filter(c=>c.publicKey===key.publicKey));
  coins.push(...first!);addresses+=batch.length;queried.push(...batch);
  progress?.(`Finding wallet funds… ${addresses}/${keys.length} addresses checked on two providers`);
  if(await enough(coins))break;
 }
 progress?.(`Funding discovery: ${addresses} addresses in ${Math.round(performance.now()-started)} ms. Verifying BCH inputs…`);
 return {coins,addresses,queried,milliseconds:performance.now()-started};
}
