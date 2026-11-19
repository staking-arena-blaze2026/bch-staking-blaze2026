import type {StoredInclusion} from '../../src/electrum-core';
import type {DiscoveryScope} from '../../src/queue/wallet';
import type {WalletKey} from '../../src/transactions-core';

interface Entry {
 version:1;
 savedAt:number;
 scope?:DiscoveryScope;
 evidence:Record<string,StoredInclusion[]>;
 keys:WalletKey[];
}
const fingerprint=/^[a-f0-9]{64}$/;
const publicKey=/^(02|03)[a-f0-9]{64}$/;
const lockingScript=/^76a914[a-f0-9]{40}88ac$/;
const validKey=(key:WalletKey)=>key&&publicKey.test(key.publicKey)&&['receive','change','defi'].includes(key.path)&&Number.isSafeInteger(key.index)&&key.index>=0&&key.index<200;

/** Optional discovery hints. The signing/recovery database is never opened here. */
export class WalletDiscoveryStore {
 private database?:Promise<IDBDatabase>;
 constructor(readonly network:string,readonly endpoints:string[]){}
 private open(){
  return this.database??=new Promise<IDBDatabase>((resolve,reject)=>{
   const request=indexedDB.open('staking-arena-wallet-discovery-'+this.network,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('wallets');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
   request.onblocked=()=>reject(Error('Wallet discovery cache is unavailable'));
  });
 }
 async load(id:string):Promise<Entry|undefined>{
  if(!fingerprint.test(id))return;
  const db=await this.open(),saved=await new Promise<Entry|undefined>((resolve,reject)=>{
   const request=db.transaction('wallets').objectStore('wallets').get(id);
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
  });
  const now=Date.now();
  if(!saved||saved.version!==1||!Number.isSafeInteger(saved.savedAt)||saved.savedAt>now||now-saved.savedAt>7*86400_000)return;
  const keys=Array.isArray(saved.keys)?saved.keys.slice(0,600).filter(validKey):[];
  const scope=saved.scope;
  const usable=scope?.id===id&&Number.isSafeInteger(scope.expires)&&scope.expires>=now&&scope.expires<=now+30000&&scope.keys instanceof Map&&scope.keys.size<=600&&scope.peers instanceof Map&&scope.peers.size<=this.endpoints.length;
  const safeScope=usable&&[...scope.keys].every(([script,key])=>lockingScript.test(script)&&validKey(key))&&[...scope.peers].every(([peer,cache])=>
   this.endpoints.includes(peer)&&!!cache&&fingerprint.test(cache.tip)&&cache.rows instanceof Map&&cache.rows.size<=600&&[...cache.rows].every(([script,coins])=>
    scope.keys.has(script)&&Array.isArray(coins)&&coins.length<=512&&coins.every(c=>c?.utxo?.lockingBytecode===script&&fingerprint.test(c.utxo.txid)&&Number.isSafeInteger(c.utxo.vout)&&c.utxo.vout>=0&&c.utxo.vout<=0xffffffff&&typeof c.utxo.satoshis==='bigint'&&c.utxo.satoshis>=0n&&c.utxo.satoshis<=2100000000000000n&&(!c.utxo.token||!c.utxo.token.nft&&fingerprint.test(c.utxo.token.category)&&typeof c.utxo.token.amount==='bigint'&&c.utxo.token.amount>0n&&c.utxo.token.amount<=0x7fffffffffffffffn))));
  const evidence=Object.fromEntries(this.endpoints.flatMap(peer=>Array.isArray(saved.evidence?.[peer])?[[peer,saved.evidence[peer]!.slice(-32)]]:[]));
  return {...saved,keys,scope:safeScope?scope:undefined,evidence};
 }
 async save(id:string,snapshot:{scope?:DiscoveryScope;evidence:ReadonlyArray<readonly [string,StoredInclusion[]]>},invalidate=false){
  if(!fingerprint.test(id))return;
  const db=await this.open(),savedAt=Date.now(),scope=snapshot.scope;
  const funded=new Set(scope&&[...scope.peers.values()].flatMap(cache=>[...cache.rows].filter(([,coins])=>coins.length).map(([script])=>script)));
  const hints=scope?[...scope.keys].filter(([script])=>funded.has(script)).map(([,key])=>key):[];
  const usable=scope&&[...scope.peers.values()].every(cache=>[...cache.rows.values()].every(coins=>coins.length<=512));
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction('wallets','readwrite',{durability:'strict'}),store=tx.objectStore('wallets'),read=store.get(id);
   read.onsuccess=()=>{
    const previous=read.result as Entry|undefined;
    if(previous?.version===1&&previous.savedAt>savedAt)return;
    const old=Array.isArray(previous?.keys)?previous.keys.slice(0,600).filter(validKey):[];
    // Newly funded children take priority. History remains useful as a hint if
    // a coin has since been spent or reserved by the separate transaction journal.
    const keys=[...new Map([...old,...hints].map(key=>[key.path+':'+key.index,key])).values()].slice(-600);
    const evidence=Object.fromEntries(snapshot.evidence.map(([peer,proofs])=>{
     const prior=Array.isArray(previous?.evidence?.[peer])?previous.evidence[peer]!.slice(-32):[];
     const merged=new Map(prior.filter(p=>p&&fingerprint.test(p.txid)).concat(proofs).map(p=>[p.txid+':'+p.height,p]));
     return [peer,[...merged.values()].slice(-32)];
    }));
    store.put({version:1,savedAt,keys,scope:invalidate?undefined:usable?scope:previous?.scope,evidence} satisfies Entry,id);
   };
   tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
  });
 }
}
