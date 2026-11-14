import type {ElectrumCore} from '../electrum-core.js';
import {coinIdentity,walletPeers} from '../electrum-wallet.js';
import {walletScript,type WalletKey,type WalletCoin} from '../transactions-core.js';

// Hints cache only public keys and recently observed outpoints, never authorization or balances.
// Every visited address is read afresh on both peers; zero-balance addresses remain searchable.
const hints=new WeakMap<ElectrumCore,Map<string,WalletCoin[]>>();
export async function discoverFunding(p:ElectrumCore,keys:WalletKey[],enough:(coins:WalletCoin[])=>boolean,progress?:(message:string)=>void){
 if(!keys.length||keys.length>600||new Set(keys.map(k=>`${k.path}:${k.index}`)).size!==keys.length||keys.some(k=>!['receive','change','defi'].includes(k.path)||!Number.isInteger(k.index)||k.index<0||k.index>=200))throw Error('Invalid bounded wallet descriptor');
 const cache=hints.get(p)??new Map<string,WalletCoin[]>();hints.set(p,cache);
 const ordered=[...keys].sort((a,b)=>Number(!!cache.get(b.publicKey)?.length)-Number(!!cache.get(a.publicKey)?.length)||a.index-b.index||a.path.localeCompare(b.path));
 const coins:WalletCoin[]=[],started=performance.now();let addresses=0;
 progress?.('Finding wallet funds…');
 for(let start=0;start<ordered.length;start+=6){
  const batch=ordered.slice(start,start+6);let first:WalletCoin[]|undefined;
  for(const peer of walletPeers(p)){
   const found=await p.session(async()=>{
    const tip=await p.tip();
    const settled=await Promise.allSettled(batch.map(async key=>(await p.getUtxosForLockingBytecode(walletScript(key.publicKey))).map(utxo=>({...key,utxo}))));
    const rows:WalletCoin[]=[];for(const result of settled){if(result.status==='rejected')throw result.reason;rows.push(...result.value);}
    if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during funding discovery; retry');
    return rows.sort((a,b)=>coinIdentity(a.utxo).localeCompare(coinIdentity(b.utxo)));
   },peer);
   if(first&&first.map(c=>coinIdentity(c.utxo)).join('\n')!==found.map(c=>coinIdentity(c.utxo)).join('\n'))throw Error('Independent funding providers disagree; retry discovery');
   first=found;
  }
  for(const key of batch)cache.set(key.publicKey,first!.filter(c=>c.publicKey===key.publicKey));
  coins.push(...first!);addresses+=batch.length;
  progress?.(`Finding wallet funds… ${addresses}/${keys.length} addresses checked on two providers`);
  if(enough(coins))break;
 }
 progress?.(`Funding discovery: ${addresses} addresses in ${Math.round(performance.now()-started)} ms. Verifying BCH inputs…`);
 return {coins,addresses,milliseconds:performance.now()-started};
}
