import {activeConflictPeers} from '../../src/chipnet-policy';
/** Public provider-host conflict latch only. This database is separate from every
 * wallet/claim journal and stores no scripts, addresses, transactions or balances. */
export async function providerConflictStore(network:string){
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(`arena-${network}-provider-conflicts`,1);request.onupgradeneeded=()=>request.result.createObjectStore('evidence');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Provider conflict storage unavailable'));});
 const read=()=>new Promise<string[]>((resolve,reject)=>{const tx=db.transaction('evidence','readwrite'),store=tx.objectStore('evidence'),request=store.get('hosts');let active:string[]=[];request.onsuccess=()=>{const hosts=Array.isArray(request.result)?request.result:[];active=activeConflictPeers(network,hosts);if(active.length!==hosts.length)store.put({hosts,reason:'OptnLabs excluded by explicit upgraded-chain provider policy; original conflict retained'},'pre-restoration-conflict');};tx.oncomplete=()=>resolve(active);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 const save=(hosts:string[])=>new Promise<void>((resolve,reject)=>{const tx=db.transaction('evidence','readwrite');tx.objectStore('evidence').put(hosts,'hosts');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 return {read,save};
}
