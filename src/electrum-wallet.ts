import {boundedMap} from './bounded-map.js';
import {tickContext,matureCoinbase} from './consensus-clock.js';
import {verifiedProviders,ProviderVerificationError} from './verified-providers.js';
import {checkFundingInputCount,FundingSelectionError} from './wallet-funding-policy.js';
import {ancestryVerifier} from './zero-conf.js';
import {Network,type SpendableUtxo} from 'cashscript';
import {ChainExtension,BLOCKCHAIN_REFRESH,ElectrumCore,type Header} from './electrum-core.js';
import {json,utxo} from './arena-core.js';
import {walletScript,type WalletKey,type WalletCoin} from './transactions-core.js';
export {ChainExtension,BLOCKCHAIN_REFRESH};
export function walletPeers(p:ElectrumCore){if(p.network!==Network.MAINNET&&p.network!==Network.CHIPNET&&p.network!==Network.REGTEST)throw Error('Wallet transactions require mainnet, chipnet or local regtest');const peers=p.endpoints.filter((v,i,a)=>a.findIndex(x=>new URL(x).hostname===new URL(v).hostname)===i);if(peers.length<2)throw Error('Two different configured WSS hosts are required');return peers;}
export const coinIdentity=(u:SpendableUtxo)=>json({txid:u.txid,vout:u.vout,satoshis:u.satoshis,script:u.lockingBytecode,token:u.token??null});
export async function confirmedWalletTransaction(p:ElectrumCore,id:string){
 return verifiedProviders(p,walletPeers(p),async(_peer,p)=>{
  const tip=await p.tip(),value=await p.transactionStatus(id);
  if((await p.tip()).hash!==tip.hash)throw Error('Tip changed during transaction verification');
  return {value,tip,identity:json({tip:tip.hash,height:value.height,blockhash:value.blockhash,hex:value.hex})};
 },{parallel:true});
}
class ChangedWalletInput extends Error {}
type VerifyOrigin=(source:ElectrumCore,ancestry:ReturnType<typeof ancestryVerifier>)=>Promise<void>;

/** Verify supplied public source coins against raw transactions, token UTXOs, proofs and linked tip headers. */
export async function verifyCoins(p:ElectrumCore,coins:SpendableUtxo[],peer:string,allowUnconfirmed=false,verifyOrigin?:VerifyOrigin){
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),transactions=new Map<string,any>(),scriptCoins=new Map<string,SpendableUtxo[]>(),context=await tickContext(p,tip),ancestry=ancestryVerifier(p,{height:tip.height,mtp,...context},tip);
 const selected=new Set(coins.map(coin=>coin.txid+':'+coin.vout));
 await boundedMap([...new Set(coins.map(c=>c.lockingBytecode).filter((s):s is string=>!!s))],4,async script=>{scriptCoins.set(script,await p.getUtxosForLockingBytecode(script,selected));});
 for(const coin of coins){
  if(!coin.lockingBytecode)throw Error('Missing source script');
  const actual=scriptCoins.get(coin.lockingBytecode)!.find(u=>u.txid===coin.txid&&u.vout===coin.vout);
  if(!actual){
   // Missing listunspent data alone is propagation/availability evidence. A raw,
   // independently validated spender is a security conflict, even on one peer.
   for(const row of await p.history(coin.lockingBytecode)){
    if(row.tx_hash===coin.txid)continue;
    const candidate=await p.transaction(row.tx_hash);
    if(!candidate.vin.some((i:any)=>i.txid===coin.txid&&i.vout===coin.vout))continue;
    if(row.height>0)await p.transactionStatus(row.tx_hash,row,tip);else await ancestry(row.tx_hash);
    throw new ChangedWalletInput('Known double-spend conflict for selected input');
   }
   throw new ChangedWalletInput('Input availability temporarily unverified');
  }
  if(coinIdentity(actual)!==coinIdentity(coin))throw new ChangedWalletInput('Source-output proof mismatch');
  let status=transactions.get(coin.txid);if(!status){
   const height=(actual as SpendableUtxo&{height?:number}).height;
   const observed=height===undefined?undefined:{tx_hash:coin.txid,height};
   status=allowUnconfirmed?await ancestry(coin.txid,observed):await p.transactionStatus(coin.txid,observed,tip);
   transactions.set(coin.txid,status);
  }
  if(!allowUnconfirmed&&status.confirmations<=0)throw Error('Only confirmed wallet/covenant inputs may be spent');
  if(status.vin?.length===1&&status.vin[0].vout===0xffffffff&&/^0+$/.test(status.vin[0].txid)&&!matureCoinbase(status.height,context))throw Error('Immature coinbase input');
  if(coinIdentity(utxo(status,coin.vout))!==coinIdentity(coin))throw new ChangedWalletInput('Source-output proof mismatch');
 }
 await verifyOrigin?.(p,ancestry);
 const moved=await p.classifyTipChange(tip);if(moved==='extension')throw new ChainExtension();if(moved==='reorg')throw Error('Reorganization during input verification');
 return {height:tip.height,hash:tip.hash,mtp,...context,peer,...(allowUnconfirmed?{ancestry:[...ancestry.evidence].map(([id,tx])=>[id,tx.hex,tx.height??0,tx.confirmations>0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))}:{})};
}
export async function verifyCoinsAcrossPeers(p:ElectrumCore,coins:SpendableUtxo[],allowUnconfirmed=false,progress?:(message:string)=>void,options:{verifyOrigin?:VerifyOrigin;readFeeRate?:(source:ElectrumCore)=>Promise<bigint>}={}) {
 let changedInput=false;
 try {
  return await verifiedProviders(p,walletPeers(p),async (peer,source)=>{
   let value;
   try { value=await verifyCoins(source,coins,peer,allowUnconfirmed,options.verifyOrigin); }
   catch(error){
    if(error instanceof ChangedWalletInput)changedInput=true;
    throw error;
   }
   const feeRate=await options.readFeeRate?.(source),tip=await source.tip();
   if(tip.hash!==value.hash){const moved=await source.classifyTipChange(value);if(moved==='reorg')throw Error('Reorganization after input verification');throw new ChainExtension();}
   return {value:{...value,feeRate},tip,identity:json({hash:value.hash,mtp:value.mtp,ancestry:value.ancestry,feeRate})};
  },{onProgress:progress,parallel:true});
 }catch(error){
  if(changedInput&&error instanceof ProviderVerificationError&&!p.unresolvedChainPeers?.size)
   Object.assign(error,{details:{code:'selected-inputs-changed'}});
  throw error;
 }
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
  progress?.(`Checking wallet balances: attempt ${attempt}/3. Verifying all ${keys.length} supplied addresses on two selected-network providers…`);
  try {
   const result=await verifiedProviders(p,peers,async (peer,p)=>{
     const peerIndex=peers.indexOf(peer);
     const tip=await p.tip(),found:WalletCoin[]=[],expected=new Map<number,string>(),transactions=new Map<string,Promise<any>>();
     // Four addresses at a time bounds server load. Scan EVERY supplied child,
     // including those after an unused gap; listunspent always includes CashTokens.
     for(let start=0;start<keys.length;start+=4) {
      const batch=keys.slice(start,start+4);
      const settled=await Promise.allSettled(batch.map(async key=>{
       const script=walletScript(key.publicKey);
       const [history,coins]=await Promise.all([p.history(script),p.getUtxosForLockingBytecode(script)]);
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
       const identity=coin.txid+':'+entry.height;if(!transactions.has(identity))transactions.set(identity,p.transaction(coin.txid,entry.height));
       const tx=await transactions.get(identity)!;
       if(expected.has(entry.height)&&expected.get(entry.height)!==tx.blockhash)throw Error('Electrum confirmation header disagreement');
       expected.set(entry.height,tx.blockhash);
       found.push({...key,utxo:coin});
      }
      progress?.(`Checking wallet balances: attempt ${attempt}/3, provider ${peerIndex+1}/${peers.length}, ${Math.min(start+4,keys.length)}/${keys.length} addresses checked.`);
     }
     // Link the union of confirmation headers once, rather than downloading
     // the same chain again for every output. Merkle/raw-output checks remain.
     await unchangedScanTip(p,tip,await p.tip());
     if(expected.size)await p.verifyHeaderChain(Math.min(...expected.keys()),tip,expected);
     await unchangedScanTip(p,tip,await p.tip());
     const coins=found.sort((a,b)=>(a.utxo.txid+':'+a.utxo.vout).localeCompare(b.utxo.txid+':'+b.utxo.vout));
     if(new Set(coins.map(c=>c.utxo.txid+':'+c.utxo.vout)).size!==coins.length)throw Error('Duplicate wallet outpoints');
     return {value:{coins,tip},tip,identity:json({coins,hash:tip.hash})};
   },{attempts:1,parallel:true});
   const coins=result.coins,tokens:Record<string,string>={};
   for(const {utxo:u} of coins)if(u.token&&!u.token.nft)tokens[u.token.category]=(BigInt(tokens[u.token.category]??0)+u.token.amount).toString();
   progress?.('Wallet balances verified on both selected-network providers.');
   return {coins,bch:coins.filter(c=>!c.utxo.token).reduce((n,c)=>n+c.utxo.satoshis,0n).toString(),tokens,addresses:keys.length,gap:0,limit:Math.max(...keys.map(k=>k.index))+1,bounded:true};
  }catch(error){
   if(error instanceof ProviderVerificationError&&error.category==='conflict')throw error;
   lastError=String(error);
   if(attempt<3){const delay=attempt*1000;progress?.(`${lastError}. Snapshot discarded. Retrying both providers in ${delay/1000}s (${attempt+1}/3)…`);await sleep(delay);}
  }
 }
 throw Error(`Wallet balances could not be verified after 3 attempts. No scan data is usable for signing. Wait for selected-network/provider synchronization, check your connection, then click Check wallet balances again. If this persists, try again when both configured Electrum providers are online and agree. Last failure: ${lastError}`);
}
export function chooseBch(coins:WalletCoin[],required:bigint,used:WalletCoin[]=[]) {
 const selected=[...used];let balance=selected.reduce((n,c)=>n+c.utxo.satoshis,0n);
 for(const c of coins.filter(c=>!c.utxo.token).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {if(balance>=required)break;if(selected.some(x=>x.utxo.txid===c.utxo.txid&&x.utxo.vout===c.utxo.vout))continue;selected.push(c);balance+=c.utxo.satoshis;}
 if(balance<required)throw new FundingSelectionError('balance',`Insufficient BCH on the checked addresses: ${balance} available satoshis; ${required} required. Additional addresses may contain funds.`,required,balance);checkFundingInputCount(selected.length);return selected;
}
export function chooseTokens(coins:WalletCoin[],category:string,amount:bigint) {
 const selected:WalletCoin[]=[];let total=0n;
 for(const c of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.token!.amount>b.utxo.token!.amount?-1:1)){if(total>=amount)break;selected.push(c);total+=c.utxo.token!.amount;}
 if(total<amount)throw new FundingSelectionError('tokens',`Found ${total} eligible fungible units; ${amount} required on the checked addresses.`);checkFundingInputCount(selected.length);
 try{return chooseBch(coins,13000n,selected);}catch(error){
  for(const coin of coins.filter(c=>c.utxo.token?.category===category&&!c.utxo.token.nft).sort((a,b)=>a.utxo.satoshis>b.utxo.satoshis?-1:1)) {
   if(selected.some(c=>c.utxo.txid===coin.utxo.txid&&c.utxo.vout===coin.utxo.vout))continue;
   selected.push(coin);checkFundingInputCount(selected.length);
   try{return chooseBch(coins,13000n,selected);}catch{}
  }throw error;
 }

}
