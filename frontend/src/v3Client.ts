import {activeNetwork,networkLeaving} from './activeNetwork';
interface Task {resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;operation:string;started:number;stage:string;stageStarted:number}
interface Client {cancel:(error:Error)=>void;worker:Worker;ready:Promise<void>;tasks:Map<number,Task>}
let client:Client|undefined,reader:Client|undefined,statusReader:Client|undefined,journal:Client|undefined,counter=0;
let selectedReadKey='';
const readers:Array<Client|undefined>=[undefined,undefined];
const reads=new Map<string,Promise<any>>();
const operationKinds=new Map<string,string>();
const progress=(message:string)=>window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:message}));
function start(readOnly=false):Client{
 const worker=new Worker(new URL('./v3.worker.ts',import.meta.url),{type:'module',name:readOnly?`${activeNetwork}:read`:activeNetwork}),tasks=new Map<number,Task>();
 let resolveReady!:()=>void,rejectReady!:(e:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const current:Client={worker,ready,tasks,cancel:()=>{}};
 const fail=(error:Error)=>{clearTimeout(startup);rejectReady(error);for(const task of tasks.values()){clearInterval(task.timer);task.reject(error);}tasks.clear();worker.terminate();if(client===current)client=undefined;if(reader===current)reader=undefined;if(statusReader===current)statusReader=undefined;if(journal===current)journal=undefined;for(let i=0;i<readers.length;i++)if(readers[i]===current)readers[i]=undefined;};
 current.cancel=fail;
 const startup=setTimeout(()=>fail(Error('V3 worker startup timeout; reconnect and reconcile saved operations')),30000);
 worker.onmessage=event=>{
  const data=event.data;
  if(data?.type==='ready'){clearTimeout(startup);resolveReady();return;}
  const task=tasks.get(data?.id);if(!task)return; // Ignore late responses after cancellation.
  if(data.type==='display-snapshot'){window.dispatchEvent(new CustomEvent('arena-vault-display',{detail:data.result}));return;}
  if(data.type==='timing'){window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{operation:task.operation,requestId:data.id,...data.timing}}));return;}
  if(data.type==='stage'){task.stage=data.stage;task.stageStarted=performance.now();return;}
  if(data.type==='funding-report'){window.dispatchEvent(new CustomEvent('arena-funding-report',{detail:data.report}));return;}
  if(data.type==='progress'){if(current===client)progress(`${data.message} (${((performance.now()-task.started)/1000).toFixed(1)}s)`);return;}
  if(data.result?.id&&data.result?.kind){if(operationKinds.size>=256)operationKinds.delete(operationKinds.keys().next().value!);operationKinds.set(data.result.id,data.result.kind);}
  tasks.delete(data.id);clearInterval(task.timer);
  data.error?task.reject(Error(data.error)):task.resolve(data.result);
 };
 worker.onerror=()=>fail(Error('V3 worker failed; saved operations remain recoverable'));
 return current;
}
function call(current:Client,intent:Record<string,unknown>,keys:unknown[]=[]):Promise<any>{
 return current.ready.then(()=>new Promise((resolve,reject)=>{
  if(networkLeaving){reject(Error('Network changed; review again'));return;}
  const id=++counter,started=performance.now(),operation=operationKinds.get(String(intent.id))??String(intent.operation);
  // A timeout cancels the worker, never abandons a still-running submission that
  // could race a retry. Signed journals survive and recovery is always explicit.
  const timer=setInterval(()=>{const t=current.tasks.get(id);if(!t)return;
   const elapsed=performance.now()-t.stageStarted;
   const limit=t.stage==='queued'?30000:t.stage==='broadcast'?45000:180000;
   if(elapsed>limit||performance.now()-started>600000){current.cancel(Error(`V3 ${t.stage} timed out; reconcile saved operations before retrying`));return;}
   if(current===client)progress(`${t.stage} · ${((performance.now()-started)/1000).toFixed(0)}s elapsed; saved operations retained`);
  },5000);
  current.tasks.set(id,{resolve,reject,timer,operation,started,stage:'queued',stageStarted:started});
  try{current.worker.postMessage({id,intent,keys,enqueuedAt:Date.now()});}catch(e){clearInterval(timer);current.tasks.delete(id);reject(e);}
 }));
}
/** Independent read transports cannot queue ahead of preparation or submission. */
export function v3Call(intent:Record<string,unknown>,keys:unknown[]=[]):Promise<any>{
 if(networkLeaving)return Promise.reject(Error('Network changed; review again'));
 const op=String(intent.operation);
 if(op==='connect')return call(statusReader??=start(true),intent,[]);
 if(op==='sync'){
  const key=JSON.stringify(intent.config,(_,v)=>typeof v==='bigint'?String(v):v);
  if(selectedReadKey!==key){reader?.cancel(Error('Selected vault changed; read-only verification cancelled'));selectedReadKey=key;}
 }
 if(['sync','inspectRead'].includes(op))return call(reader??=start(true),intent,[]);
 if(['list','claims'].includes(op))return call(journal??=start(true),intent,[]);
 return call(client??=start(),intent,keys);
}
export function cancelMarketplaceReads(){for(let i=0;i<readers.length;i++){readers[i]?.cancel(Error('Marketplace verification cancelled'));readers[i]=undefined;}reads.clear();}
window.addEventListener('arena-network-leaving',()=>{client?.cancel(Error('Network changed; saved journals retained'));reader?.cancel(Error('Network changed'));statusReader?.cancel(Error('Network changed'));journal?.cancel(Error('Network changed'));cancelMarketplaceReads();operationKinds.clear();});
export function verifyMarketplace(config:unknown,slot:number):Promise<any>{
 const key=JSON.stringify(config,(_,v)=>typeof v==='bigint'?String(v):v),existing=reads.get(key);if(existing)return existing;
 const job=call(readers[slot%2]??=start(true),{operation:'sync',config});
 reads.set(key,job);void job.finally(()=>{if(reads.get(key)===job)reads.delete(key);}).catch(()=>{});return job;
}
