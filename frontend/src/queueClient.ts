import {activeNetwork,networkLeaving} from './activeNetwork';
import type {WalletKey} from '../../src/transactions-core';
interface Client {
 worker:Worker;
 ready:Promise<void>;
 cancel:(error:Error)=>void;
 pending:Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>;
}
let sequence=0,financial:Client|undefined,retention:Client|undefined;
const readers=new Map<string,Client>();
function client(readOnly:boolean):Client{
 const worker=new Worker(new URL('./queue.worker.ts',import.meta.url),{type:'module',name:activeNetwork+(readOnly?':read':':wallet')});
 let resolveReady!:()=>void,rejectReady!:(e:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 // Module/WASM initialization must finish before any request is posted.
 const c:Client={worker,ready,pending:new Map(),cancel:()=>{}};
 void ready.catch(()=>{});
 const fail=(error:Error)=>{
  clearTimeout(startup);rejectReady(error);
  for(const job of c.pending.values()){clearTimeout(job.timer);job.reject(error);}
  c.pending.clear();worker.terminate();
  if(financial===c)financial=undefined;
  for(const [key,value]of readers)if(value===c)readers.delete(key);
 };
 c.cancel=fail;
 const startup=setTimeout(()=>fail(Error('Queue worker startup timed out; saved journals are retained')),30000);
 worker.onmessage=e=>{
  if(e.data.type==='ready'){clearTimeout(startup);resolveReady();return;}
  if(e.data.type==='progress'){if(!readOnly)window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:e.data.message}));return;}
  if(e.data.type==='timing'){if(!readOnly)window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:e.data.timing}));return;}
  const job=c.pending.get(e.data.id);if(!job)return;
  if(e.data.type==='heartbeat'){clearTimeout(job.timer);job.timer=setTimeout(()=>c.cancel(Error('Queue worker stopped responding; reconcile saved operations before retrying')),90000);if(!readOnly)window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:e.data.message}));return;}
  clearTimeout(job.timer);c.pending.delete(e.data.id);
  e.data.error?job.reject(Object.assign(Error(e.data.error),{details:e.data.details,summary:e.data.summary})):job.resolve(e.data.result);
 };
 worker.onerror=()=>fail(Error('Queue worker failed; signed journals are retained'));
 worker.onmessageerror=()=>fail(Error('Queue worker could not deserialize its response; check recovery'));
 return c;
}
export function queueCall(intent:Record<string,unknown>,keys:WalletKey[]=[],signal?:AbortSignal):Promise<any>{
 const retaining=intent.operation==='retain'||intent.operation==='signingFailed';
 if(networkLeaving&&!retaining)return Promise.reject(Error('Network changed; review again'));
 const readOnly=['list','reportedQueue','owned','discover','creationStatus'].includes(String(intent.operation));
 const channel=String(intent.operation)==='list'?'journal':['market-0','market-1','owners','discovery','creation'].includes(String(intent.channel))?String(intent.channel):'selected';
 if(signal?.aborted)return Promise.reject(signal.reason);
 let c:Client;
 if(readOnly){if(!readers.has(channel))readers.set(channel,client(true));c=readers.get(channel)!;}
 else c=networkLeaving&&retaining?(retention??=client(false)):(financial??=client(false));
 // Only browsing callers supply a signal. Each browsing lane has one active
 // request, so terminating it also closes the obsolete Electrum transport.
 const abort=()=>c.cancel(Error('Queue browsing request superseded'));
 if(readOnly)signal?.addEventListener('abort',abort,{once:true});
 return c.ready.then(()=>new Promise((resolve,reject)=>{
  if(networkLeaving&&!retaining){reject(Error('Network changed; review again'));return;}
  const id=++sequence,timer=setTimeout(()=>c.cancel(Error('Queue request timed out; reconcile saved operations before retrying')),90000);
  c.pending.set(id,{resolve,reject,timer});
  try{c.worker.postMessage({id,intent,keys});}catch(e){clearTimeout(timer);c.pending.delete(id);reject(e);}
 })).finally(()=>signal?.removeEventListener('abort',abort));
}
window.addEventListener('arena-network-leaving',()=>{
 // This worker is permanently bound to the OLD network. Let any returned
 // signature finish journaling; new authorization/broadcast calls are blocked.
 retention=financial;retention?.worker.postMessage({id:++sequence,intent:{operation:'invalidate'}});
 for(const c of readers.values())c.cancel(Error('Network changed; signed journal retained'));
 financial=undefined;readers.clear();
});

// Session changes discard only reusable approval evidence. Returned signatures
// must still reach retain() and the durable journal, including after reconnect.
window.addEventListener('arena-queue-wallet-invalidated',()=>{
 financial?.worker.postMessage({id:++sequence,intent:{operation:'invalidate'}});
});
