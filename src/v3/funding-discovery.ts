import {ChainExtension,BLOCKCHAIN_REFRESH,type ElectrumCore,type Header} from '../electrum-core.js';
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
  const batch=ordered.slice(start,start+6);let first:WalletCoin[]|undefined;
  const fingerprint=(rows:WalletCoin[])=>rows.map(c=>coinIdentity(c.utxo)+':'+(c.utxo as {height?:number}).height).join('\n');
  for(let attempt=1;attempt<=3;attempt++){
   try{
    let observed:WalletCoin[]|undefined,observedTip:Header|undefined,observedPeer='';
    for(const peer of walletPeers(p)){
     const found=await p.session(async()=>{
      const tip=await p.tip();
      const settled=await Promise.allSettled(batch.map(async key=>(await p.getUtxosForLockingBytecode(walletScript(key.publicKey))).map(utxo=>({...key,utxo}))));
      const rows:WalletCoin[]=[];for(const result of settled){if(result.status==='rejected')throw result.reason;rows.push(...result.value);}
      const moved=await p.classifyTipChange(tip);
      if(moved==='extension')throw new ChainExtension();
      if(moved==='reorg')throw Error('Tip changed during funding discovery; retry');
      return {rows:rows.sort((a,b)=>coinIdentity(a.utxo).localeCompare(coinIdentity(b.utxo))),tip:await p.tip()};
     },peer);
     if(observed&&fingerprint(observed)!==fingerprint(found.rows)){
      const firstIsLater=observedTip!.height>found.tip.height,laterPeer=firstIsLater?observedPeer:peer,earlier=firstIsLater?found.tip:observedTip!,later=firstIsLater?observedTip!:found.tip;
      const extendsEarlier=later.height>earlier.height&&await p.session(async()=>{const at=await p.header(earlier.height);if(at.hash!==earlier.hash)return false;const tip=await p.header(later.height);if(tip.hash!==later.hash)return false;await p.verifyHeaderChain(earlier.height,tip,new Map([[earlier.height,earlier.hash]]));return true;},laterPeer);
      if(extendsEarlier)throw new ChainExtension();
      throw Error('The two chipnet providers disagree about available funds; retry discovery');
     }
     observed=found.rows;observedTip=found.tip;observedPeer=peer;
    }
    first=observed;break;
   }catch(error){
    if(!(error instanceof ChainExtension)||attempt===3)throw error;
    progress?.(BLOCKCHAIN_REFRESH);
   }
  }
  for(const key of batch)cache.set(key.publicKey,first!.filter(c=>c.publicKey===key.publicKey));
  coins.push(...first!);addresses+=batch.length;queried.push(...batch);
  progress?.(`Finding wallet funds… ${addresses}/${keys.length} addresses checked on two providers`);
  if(await enough(coins))break;
 }
 progress?.(`Funding discovery: ${addresses} addresses in ${Math.round(performance.now()-started)} ms. Verifying BCH inputs…`);
 return {coins,addresses,queried,milliseconds:performance.now()-started};
}
