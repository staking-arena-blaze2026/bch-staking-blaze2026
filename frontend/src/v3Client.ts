import {activeNetwork,networkLeaving} from './activeNetwork';
interface Task {resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
interface Client {cancel:(error:Error)=>void;worker:Worker;ready:Promise<void>;tasks:Map<number,Task>}
let client:Client|undefined,counter=0;
window.addEventListener('arena-network-leaving',()=>{if(client){client.cancel(Error('Network changed; saved journals retained'));client=undefined;}});
function start():Client{
 const worker=new Worker(new URL('./v3.worker.ts',import.meta.url),{type:'module',name:activeNetwork}),tasks=new Map<number,Task>();
 let resolveReady!:()=>void,rejectReady!:(e:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const current:Client={worker,ready,tasks,cancel:()=>{}};
 const fail=(error:Error)=>{clearTimeout(startup);rejectReady(error);for(const task of tasks.values()){clearTimeout(task.timer);task.reject(error);}tasks.clear();worker.terminate();if(client===current)client=undefined;};
 current.cancel=fail;
 const startup=setTimeout(()=>fail(Error('V3 worker startup timeout; reconnect and reconcile saved operations')),30000);
 worker.onmessage=event=>{
  if(event.data?.type==='funding-report'){window.dispatchEvent(new CustomEvent('arena-funding-report',{detail:event.data.report}));return;}
  if(event.data?.type==='progress'){window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:event.data.message}));return;}
  if(event.data?.type==='ready'){clearTimeout(startup);resolveReady();return;}
  const task=tasks.get(event.data?.id);if(!task)return;tasks.delete(event.data.id);clearTimeout(task.timer);
  event.data.error?task.reject(Error(event.data.error)):task.resolve(event.data.result);
 };
 worker.onerror=()=>fail(Error('V3 worker failed; saved operations remain recoverable'));
 return current;
}
/** Wait for module/WASM initialization before sending a request. Inspection needs no wallet; funding and claims require explicit wallet authorization. */
export async function v3Call(intent:Record<string,unknown>,keys:unknown[]=[]):Promise<any>{
 if(networkLeaving)throw Error('Network changed; review again');
 const current=client??=start();await current.ready;
 return new Promise((resolve,reject)=>{
  const id=++counter,timer=setTimeout(()=>{current.tasks.delete(id);reject(Error('V3 request timed out; reconcile saved operations before retrying'));},120000);
  current.tasks.set(id,{resolve,reject,timer});
  try{current.worker.postMessage({id,intent,keys});}catch(e){clearTimeout(timer);current.tasks.delete(id);reject(e);}
 });
}

// Background read workers have independent transports. Financial calls always use
// the original worker and its fresh action-time verification, never this pool.
const readers:Array<Client|undefined>=[undefined,undefined];
const reads=new Map<string,Promise<any>>();
export function cancelMarketplaceReads(){for(let i=0;i<readers.length;i++){const c=readers[i];if(c){c.cancel(Error('Marketplace verification cancelled'));readers[i]=undefined;}}reads.clear();}
window.addEventListener('arena-network-leaving',cancelMarketplaceReads);
export function verifyMarketplace(config:unknown,slot:number):Promise<any>{
 const key=JSON.stringify(config,(_,v)=>typeof v==='bigint'?String(v):v);
 const existing=reads.get(key);if(existing)return existing;
 const job=(async()=>{if(networkLeaving)throw Error('Network changed');const i=slot%2,current=readers[i]??=start();
 try{await current.ready;return await new Promise((resolve,reject)=>{const id=++counter,timer=setTimeout(()=>current.cancel(Error('Verification timed out — retry available')),60000);current.tasks.set(id,{resolve,reject,timer});try{current.worker.postMessage({id,intent:{operation:'sync',config},keys:[]});}catch(e){clearTimeout(timer);current.tasks.delete(id);reject(e);}});}catch(e){current.cancel(Error('Verification worker reset'));if(readers[i]===current)readers[i]=undefined;throw e;}})();
 reads.set(key,job);void job.finally(()=>{if(reads.get(key)===job)reads.delete(key);}).catch(()=>{});return job;
}
