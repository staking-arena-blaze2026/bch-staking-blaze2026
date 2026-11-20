import {activeNetwork,networkLeaving} from './activeNetwork';
import type {CatalogObservation} from '../../src/queue/catalog';
import type {WalletKey} from '../../src/transactions-core';

interface Job {
 resolve:(value:any)=>void;
 reject:(error:Error)=>void;
 timer:ReturnType<typeof setTimeout>;
 observe?:(value:CatalogObservation)=>void;
}
interface Client {
 worker:Worker;
 ready:Promise<void>;
 close:(error:Error)=>void;
 closed?:Error;
 pending:Map<number,Job>;
 active:number;
}

class WorkerFailure extends Error {
 constructor(readonly category:string, message:string, readonly frames?:string) {super(message);}
}

const readers=new Map<string,Client>();
const retryDelays=[500,1000];
const startupTimeout=30000,requestTimeout=90000;
let sequence=0,financial:Client|undefined,retention:Client|undefined;
let networkReads=new AbortController();

function diagnostic(channel:string,operation:string,event:string,attempt:number,error?:WorkerFailure) {
 const detail={network:activeNetwork,worker:channel==='wallet'?'financial':'read',channel,operation,event,attempt,
  category:error?.category,exception:error?.message,
  ...(import.meta.env.DEV&&error?.frames?{stack:error.frames}:{})};
 if(error)console.warn('Queue worker',detail);
 else if(import.meta.env.DEV||event==='recovered')console.debug('Queue worker',detail);
}

function stackFrames(stack?:string) {
 return stack?.split('\n').slice(1,9).filter(line=>/^\s+at /.test(line)).join('\n');
}

function client(readOnly:boolean, channel:string):Client {
 const failure=(category:string,description:string,frames?:string)=>new WorkerFailure(category,
  `Queue ${channel} worker ${description}${readOnly?'':'; reconcile saved operations before retrying'}`,frames);
 let worker:Worker;
 try {
  worker=new Worker(new URL('./queue.worker.ts',import.meta.url),{type:'module',name:readOnly?`${activeNetwork}:${channel}:read`:`${activeNetwork}:wallet`});
 } catch(error) {
  throw failure('startup','could not be created',error instanceof Error?stackFrames(error.stack):undefined);
 }
 let resolveReady!:()=>void,rejectReady!:(e:Error)=>void,started=false;
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 void ready.catch(()=>{});
 const c:Client={worker,ready,pending:new Map(),active:0,close};
 const startup=setTimeout(()=>close(failure('startup-timeout',`startup timed out after ${startupTimeout/1000}s`)),startupTimeout);

 function close(error:Error) {
  if(c.closed)return;
  c.closed=error;
  clearTimeout(startup);rejectReady(error);
  for(const job of c.pending.values()){clearTimeout(job.timer);job.reject(error);}
  c.pending.clear();
  worker.onmessage=worker.onerror=worker.onmessageerror=null;
  worker.terminate();
  if(financial===c)financial=undefined;
  if(retention===c)retention=undefined;
  if(readers.get(channel)===c)readers.delete(channel);
 }

 worker.onerror=event=>close(failure(started?'crash':'startup',started?'crashed':'failed during initialization',stackFrames(event?.error?.stack)));
 worker.onmessageerror=()=>close(failure('message-error','could not deserialize its response'));
 worker.onmessage=e=>{
  if(c.closed)return;
  const data=e.data;
  if(!data||typeof data!=='object'){close(failure('message-error','returned an invalid response'));return;}
  if(data.type==='ready'){started=true;clearTimeout(startup);resolveReady();return;}
  if(data.type==='fatal'){
   close(failure('unhandled-rejection','encountered an unhandled rejection',data.frames));return;
  }
  if(data.type==='progress'){if(!readOnly)window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:data.message}));return;}
  if(data.type==='timing'){if(!readOnly)window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:data.timing}));return;}
  const job=c.pending.get(data.id);if(!job)return;
  if(data.type==='catalogObservation'){job.observe?.(data.value);return;}
  if(data.type==='heartbeat'){
   // Heartbeats prove the event loop is alive, not that an Electrum/IDB await can finish.
   if(!readOnly){
    clearTimeout(job.timer);
    job.timer=setTimeout(()=>close(failure('request-timeout',`stopped responding for ${requestTimeout/1000}s`)),requestTimeout);
    window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:data.message}));
   }
   return;
  }
  if(readOnly&&data.category==='electrum-transport'){
   close(failure(data.category,data.transportReason??'lost its Electrum connection',data.frames));return;
  }
  clearTimeout(job.timer);c.pending.delete(data.id);
  if(data.error)job.reject(Object.assign(Error(data.error),{details:data.details,summary:data.summary,frames:data.frames}));
  else job.resolve(data.result);
 };
 return c;
}

function send(c:Client,intent:Record<string,unknown>,keys:WalletKey[],retaining:boolean,signal?:AbortSignal,observe?:Job['observe']) {
 let id:number|undefined,abort:()=>void;
 c.active++;
 const response=new Promise<any>((resolve,reject)=>{
  abort=()=>{
   // A journal poll and an action can share the journal reader.
   if(c.active===1)c.close(signal!.reason);
   if(id!==undefined){
    clearTimeout(c.pending.get(id)?.timer);
    c.pending.delete(id);
   }
   reject(signal!.reason);
  };
  signal?.addEventListener('abort',abort,{once:true});
  void c.ready.then(()=>{
   if(signal?.aborted){reject(signal.reason);return;}
   if(c.closed){reject(c.closed);return;}
   if(networkLeaving&&!retaining){reject(Error('Network changed; review again'));return;}
   id=++sequence;
   const timer=setTimeout(()=>c.close(new WorkerFailure('request-timeout',
    `Queue request timed out after ${requestTimeout/1000}s${signal?'':'; reconcile saved operations before retrying'}`)),requestTimeout);
   c.pending.set(id,{resolve,reject,timer,observe});
   try{c.worker.postMessage({id,intent,keys});}
   catch(error){c.close(new WorkerFailure('post-message',`Queue worker could not accept the request${signal?'':'; reconcile saved operations before retrying'}`,error instanceof Error?stackFrames(error.stack):undefined));}
  },reject);
 });
 return response.finally(()=>{
  c.active--;
  signal?.removeEventListener('abort',abort);
 });
}

function waitToRetry(delay:number,signal:AbortSignal) {
 return new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delay);
  signal.addEventListener('abort',abort,{once:true});
 });
}

async function read(channel:string,operation:string,intent:Record<string,unknown>,signal:AbortSignal,observe?:Job['observe']) {
 for(let attempt=0;;attempt++){
  signal.throwIfAborted();
  try {
   let c=readers.get(channel);
   if(!c){c=client(true,channel);readers.set(channel,c);}
   const result=await send(c,intent,[],false,signal,observe);
   signal.throwIfAborted();
   if(attempt)diagnostic(channel,operation,'recovered',attempt+1);
   return result;
  } catch(error) {
   signal.throwIfAborted();
   if(!(error instanceof WorkerFailure)){
    diagnostic(channel,operation,'request failed',attempt+1,new WorkerFailure('read-error','Queue read rejected',(error as {frames?:string})?.frames));
    throw error;
   }
   const delay=retryDelays[attempt];
   diagnostic(channel,operation,delay===undefined?'recovery exhausted':'retry scheduled',attempt+1,error);
   if(delay===undefined)throw Object.assign(error,{recoveryExhausted:true});
   await waitToRetry(delay,signal);
  }
 }
}

export async function queueCall(intent:Record<string,unknown>,keys:WalletKey[]=[],signal?:AbortSignal,observe?:Job['observe']):Promise<any>{
 const operation=String(intent.operation);
 const retaining=operation==='retain'||operation==='signingFailed';
 if(networkLeaving&&!retaining)throw Error('Network changed; review again');
 const readOnly=['list','reportedQueue','catalog','owned','discover','creationStatus'].includes(operation);
 if(readOnly){
  const channel=operation==='list'?'journal':operation==='catalog'?'catalog':['market-0','market-1','owners','discovery','creation'].includes(String(intent.channel))?String(intent.channel):'selected';
  // Browsing callers with a signal own their lane. Journal readers may share a
  // worker, and all readers are scoped to this page's network.
  signal?.throwIfAborted();
  const networkSignal=networkReads.signal,cancelled=new AbortController();
  const leave=()=>cancelled.abort(networkSignal.reason);
  const supersede=()=>cancelled.abort(Error('Queue browsing request superseded'));
  networkSignal.addEventListener('abort',leave,{once:true});
  signal?.addEventListener('abort',supersede,{once:true});
  try{return await read(channel,operation,intent,cancelled.signal,observe);}
  finally{
   networkSignal.removeEventListener('abort',leave);
   signal?.removeEventListener('abort',supersede);
  }
 }
 try {
  const c=networkLeaving&&retaining?(retention??=client(false,'wallet')):(financial??=client(false,'wallet'));
  // Financial RPCs are single-attempt. The durable journal drives reconciliation.
  return await send(c,intent,keys,retaining);
 } catch(error) {
  if(error instanceof WorkerFailure)diagnostic('wallet',operation,'worker failed',1,error);
  throw error;
 }
}

function invalidate(c?:Client) {
 if(!c||c.closed)return;
 try{c.worker.postMessage({id:++sequence,intent:{operation:'invalidate'}});}
 catch{c.close(new WorkerFailure('post-message','Queue wallet worker could not invalidate reviews; reconcile saved operations before retrying'));}
}

window.addEventListener('arena-network-leaving',()=>{
 networkReads.abort(Error('Network changed; review again'));
 networkReads=new AbortController();
 for(const c of readers.values())c.close(Error('Network changed; review again'));
 // The old worker can still journal a signature already requested from the wallet.
 retention=financial;financial=undefined;
 invalidate(retention);
});
window.addEventListener('arena-queue-wallet-invalidated',()=>invalidate(financial));
