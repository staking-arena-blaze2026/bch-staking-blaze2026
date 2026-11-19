import type {ArchiveCheckpoint,ArchiveRow,Config} from '../../src/queue/chain';

interface Entry {checkpoint:ArchiveCheckpoint;rows:ArchiveRow[]}
function request<T>(operation:IDBRequest<T>){
 return new Promise<T>((resolve,reject)=>{
  operation.onsuccess=()=>resolve(operation.result);
  operation.onerror=()=>reject(operation.error);
 });
}
const key=(config:Config,owner:string)=>config.anchor.genesis+':'+owner;

export async function queueArchiveStore(network:string){
 const open=indexedDB.open('arena-queue-archive-v1-'+network,1);
 open.onupgradeneeded=()=>open.result.createObjectStore('archives');
 const db=await request(open);
 return {
  read:async(config:Config,owner:string):Promise<Entry|undefined>=>{
   try{return await request(db.transaction('archives').objectStore('archives').get(key(config,owner)));}
   finally{db.close();}
  },
  save:async(config:Config,owner:string,entry:Entry)=>{
   const confirmed=new Map(entry.checkpoint.terminals),finished=new Set(entry.checkpoint.finished);
   const rows=entry.rows.flatMap(row=>{
    const terminal=confirmed.get(row.id);
    return terminal?[{...row,...terminal,status:finished.has(row.id)?'Finished':terminal.status,eligible:false}]:[];
   });
   try{
    const tx=db.transaction('archives','readwrite');
    await new Promise<void>((resolve,reject)=>{
     tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);
     tx.objectStore('archives').put({...entry,rows},key(config,owner));
    });
   }finally{db.close();}
  },
 };
}
