import {ancestryVerifier} from './zero-conf.js';
import {Network,type SpendableUtxo} from 'cashscript';
import {ElectrumCore,type Header} from './electrum-core.js';
import {json,utxo} from './arena-core.js';
import {walletScript,type WalletKey,type WalletCoin} from './transactions-core.js';
export function walletPeers(p:ElectrumCore){if(p.network!==Network.CHIPNET&&p.network!==Network.REGTEST)throw Error('Wallet transactions require chipnet or local regtest');const peers=p.endpoints.filter((v,i,a)=>a.findIndex(x=>new URL(x).hostname===new URL(v).hostname)===i);if(peers.length<2)throw Error('Two different configured WSS hosts are required');return peers.slice(0,2);}
export const coinIdentity=(u:SpendableUtxo)=>json({txid:u.txid,vout:u.vout,satoshis:u.satoshis,script:u.lockingBytecode,token:u.token??null});
export async function confirmedWalletTransaction(p:ElectrumCore,id:string){
 let first:any;
 for(const peer of walletPeers(p)){const tx=await p.session(()=>p.transactionStatus(id),peer);if(first&&(first.height!==tx.height||first.blockhash!==tx.blockhash||first.hex!==tx.hex))throw Error('Electrum transaction confirmation disagreement');first=tx;}
 return first;
}
/** Verify supplied public source coins against raw transactions, token UTXOs, proofs and linked tip headers. */
export async function verifyCoins(p:ElectrumCore,coins:SpendableUtxo[],peer:string,allowUnconfirmed=false){
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),transactions=new Map<string,any>(),ancestry=ancestryVerifier(p,{height:tip.height,mtp});
 for(const coin of coins){
  if(!coin.lockingBytecode)throw Error('Missing source script');
  const actual=(await p.getUtxosForLockingBytecode(coin.lockingBytecode)).find(u=>u.txid===coin.txid&&u.vout===coin.vout);
  if(!actual||coinIdentity(actual)!==coinIdentity(coin))throw Error('Input spent, pending, or changed; rebuild and request fresh approval');
  let status=transactions.get(coin.txid);if(!status){status=allowUnconfirmed?await ancestry(coin.txid):await p.transactionStatus(coin.txid);transactions.set(coin.txid,status);}if(!allowUnconfirmed&&status.confirmations<=0)throw Error('Only confirmed wallet/covenant inputs may be spent');
  if(allowUnconfirmed&&status.vin?.length===1&&status.vin[0].vout===0xffffffff&&/^0+$/.test(status.vin[0].txid)&&status.confirmations<100)throw Error('Immature coinbase input');
  if(coinIdentity(utxo(status,coin.vout))!==coinIdentity(coin))throw Error('Source-output proof mismatch');
 }
 if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during input verification');
 return {height:tip.height,hash:tip.hash,mtp,peer,...(allowUnconfirmed?{ancestry:[...ancestry.evidence].map(([id,tx])=>[id,tx.hex,tx.height??0,tx.confirmations>0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))}:{})};
}
export async function verifyCoinsAcrossPeers(p:ElectrumCore,coins:SpendableUtxo[],allowUnconfirmed=false) {
 let first:Awaited<ReturnType<typeof verifyCoins>>|undefined;
 for(const peer of walletPeers(p)){const value=await p.session(()=>verifyCoins(p,coins,peer,allowUnconfirmed),peer);if(first&&(first.hash!==value.hash||first.mtp!==value.mtp||json(first.ancestry)!==json(value.ancestry)))throw Error('Electrum tip/MTP disagreement');first=value;}
 return first!;
}
export interface WalletInventory {coins:WalletCoin[];bch:string;tokens:Record<string,string>;addresses:number;gap:number;limit:number;bounded:true}
/** A changed tip is never accepted as a snapshot. Prove extension, then restart all reads. */
async function unchangedScanTip(p:ElectrumCore,initial:Header,current:Header) {
 if(current.hash===initial.hash&&current.height===initial.height)return;
 if(current.height>initial.height&&(await p.header(initial.height)).hash===initial.hash){
  await p.verifyHeaderChain(initial.height,current,new Map([[initial.height,initial.hash]]));
  throw Error('Wallet scan: normal blockchain extension; restarting at the new block');
 }
 throw Error('Wallet scan: reorganization or contradictory tip data; discarding snapshot');
}
export interface WalletScanOptions {onProgress?:(message:string)=>void; /** Injectable delay for deterministic tests. */ sleep?:(ms:number)=>Promise<void>}
export async function scanWallet(p:ElectrumCore,keys:WalletKey[],options:WalletScanOptions={}):Promise<WalletInventory> {
 if(!keys.length||keys.length>600||new Set(keys.map(k=>`${k.path}:${k.index}`)).size!==keys.length)throw Error('Invalid bounded wallet address descriptor');
 for(const key of keys)if(!['receive','change','defi'].includes(key.path)||!Number.isInteger(key.index)||key.index<0||key.index>=200)throw Error('Invalid wallet derivation');
 const peers=walletPeers(p),progress=options.onProgress,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 let lastError='';
 for(let attempt=1;attempt<=3;attempt++) {
  progress?.(`Checking wallet balances: attempt ${attempt}/3. Verifying all ${keys.length} supplied addresses on two chipnet providers…`);
  try {
   let first:WalletCoin[]|undefined,anchor:Header|undefined;
   for(const [peerIndex,peer] of peers.entries()) {
    const result=await p.session(async()=>{
     const tip=await p.tip(),found:WalletCoin[]=[],expected=new Map<number,string>();
     if(anchor)await unchangedScanTip(p,anchor,tip);
     // Four addresses at a time bounds server load. Scan EVERY supplied child,
     // including those after an unused gap; listunspent always includes CashTokens.
     for(let start=0;start<keys.length;start+=4) {
      const batch=keys.slice(start,start+4);
      const settled=await Promise.allSettled(batch.map(async key=>{
       const script=walletScript(key.publicKey);
       const history=await p.history(script),coins=await p.getUtxosForLockingBytecode(script);
       return {key,history,coins};
      }));
      // Drain all in-flight reads before closing/retrying the pinned session.
      const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
      const rows=settled.map(r=>{if(r.status==='rejected')throw r.reason;return r.value;});
      for(const {key,history,coins} of rows)for(const coin of coins){
       const entry=history.find(h=>h.tx_hash===coin.txid);
       if(!entry)throw Error('Electrum wallet history/UTXO disagreement');
       if(entry.height<=0)continue;
       if(entry.height>tip.height){await unchangedScanTip(p,tip,await p.tip());throw Error('Electrum confirmation ahead of wallet scan tip');}
       const tx=await p.transaction(coin.txid,entry.height);
       if(expected.has(entry.height)&&expected.get(entry.height)!==tx.blockhash)throw Error('Electrum confirmation header disagreement');
       expected.set(entry.height,tx.blockhash);
       found.push({...key,utxo:coin});
      }
      progress?.(`Checking wallet balances: attempt ${attempt}/3, provider ${peerIndex+1}/2, ${Math.min(start+4,keys.length)}/${keys.length} addresses checked.`);
     }
     // Link the union of confirmation headers once, rather than downloading
     // the same chain again for every output. Merkle/raw-output checks remain.
     await unchangedScanTip(p,tip,await p.tip());
     if(expected.size)await p.verifyHeaderChain(Math.min(...expected.keys()),tip,expected);
     await unchangedScanTip(p,tip,await p.tip());
     const coins=found.sort((a,b)=>(a.utxo.txid+':'+a.utxo.vout).localeCompare(b.utxo.txid+':'+b.utxo.vout));
     if(new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('Duplicate wallet outpoints');
     return {coins,tip};
    },peer);
    if(first&&json(first)!==json(result.coins))throw Error('Electrum wallet UTXO disagreement');
    first=result.coins;anchor=result.tip;
   }
   // The first provider may have advanced while the second was being scanned.
   await p.session(async()=>unchangedScanTip(p,anchor!,await p.tip()),peers[0]);
   const coins=first!,tokens:Record<string,string>={};
   for(const {utxo:u} of coins)if(u.token&&!u.token.nft)tokens[u.token.category]=(BigInt(tokens[u.token.category]??0)+u.token.amount).toString();
   progress?.('Wallet balances verified on both chipnet providers.');
   return {coins,bch:coins.filter(c=>!c.utxo.token).reduce((n,c)=>n+c.utxo.satoshis,0n).toString(),tokens,addresses:keys.length,gap:0,limit:Math.max(...keys.map(k=>k.index))+1,bounded:true};
  }catch(error){
   lastError=String(error);
   if(attempt<3){const delay=attempt*1000;progress?.(`${lastError}. Snapshot discarded. Retrying both providers in ${delay/1000}s (${attempt+1}/3)…`);await sleep(delay);}
  }
 }
 throw Error(`Wallet balances could not be verified after 3 attempts. No scan data is usable for signing. Wait for chipnet/provider synchronization, check your connection, then click Check wallet balances again. If this persists, try again when both configured Electrum providers are online and agree. Last failure: ${lastError}`);
}
export function chooseBch(coins:WalletCoin[],required:bigint,used:WalletCoin[]=[]) {
 const selected=[...used];let balance=selected.reduce((n,c)=>n+c.utxo.satoshis,0n);
 for(const c of coins.filter(c=>!c.utxo.token).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {if(balance>=required)break;if(selected.some(x=>x.utxo.txid===c.utxo.txid&&x.utxo.vout===c.utxo.vout))continue;selected.push(c);balance+=c.utxo.satoshis;}
 if(balance<required||selected.length>8)throw Error('Insufficient BCH in the bounded wallet scan (maximum eight inputs); consolidate in your wallet or expand the scan');return selected;
}
export function chooseTokens(coins:WalletCoin[],category:string,amount:bigint) {
 const selected:WalletCoin[]=[];let total=0n;
 for(const c of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.token!.amount>b.utxo.token!.amount?-1:1)){if(total>=amount)break;selected.push(c);total+=c.utxo.token!.amount;}
 if(total<amount||selected.length>8)throw Error('Insufficient selected fungible token balance in the scanned wallet addresses');
 try{return chooseBch(coins,13000n,selected);}catch(error){
  for(const coin of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {
   if(selected.some(c=>c.utxo.txid===coin.utxo.txid&&c.utxo.vout===coin.utxo.vout))continue;
   selected.push(coin);if(selected.length>8)break;
   try{return chooseBch(coins,13000n,selected);}catch{}
  }throw error;
 }

}
