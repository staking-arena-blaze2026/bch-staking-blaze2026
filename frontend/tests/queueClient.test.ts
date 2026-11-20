import {it,expect,vi,afterEach} from 'vitest';
const networkState=vi.hoisted(()=>({leaving:false,network:"chipnet"}));
vi.mock('../src/activeNetwork',()=>({get activeNetwork(){return networkState.network;},get networkLeaving(){return networkState.leaving;}}));
import {queueCall} from '../src/queueClient';
class WorkerMock {
 static instances:WorkerMock[]=[];
 onmessage:((e:any)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(_url?:URL,readonly options?:WorkerOptions){WorkerMock.instances.push(this);}
 ready(){this.onmessage?.({data:{type:'ready'}});}
 respond(result:unknown){this.onmessage?.({data:{id:this.postMessage.mock.calls.at(-1)![0].id,result}});}
}
afterEach(()=>{networkState.leaving=false;networkState.network="chipnet";window.dispatchEvent(new Event('arena-network-leaving'));WorkerMock.instances=[];vi.useRealTimers();});
it('waits for module/WASM readiness before posting the first request',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'reportedQueue',config:{}}),worker=WorkerMock.instances[0]!;
 expect(worker.postMessage).not.toHaveBeenCalled();worker.ready();await Promise.resolve();expect(worker.postMessage).toHaveBeenCalledOnce();worker.respond({verified:true});await expect(pending).resolves.toEqual({verified:true});
});
it('terminates timed-out financial workers and creates a fresh worker for recovery',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'submit',id:'retained'}),worker=WorkerMock.instances[0]!;
 const failure=expect(pending).rejects.toThrow('reconcile saved operations');worker.ready();await Promise.resolve();await vi.advanceTimersByTimeAsync(90000);await failure;expect(worker.terminate).toHaveBeenCalledOnce();
 const recovery=queueCall({operation:'resume',id:'retained'}),next=WorkerMock.instances[1]!;expect(next).not.toBe(worker);next.ready();await Promise.resolve();next.respond({retained:true});await expect(recovery).resolves.toEqual({retained:true});
});
it('keeps journal and discovery readers independent of financial work',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const requests=[queueCall({operation:'prepare'}),queueCall({operation:'list'}),queueCall({operation:'reportedQueue',channel:'market-0'})];expect(WorkerMock.instances).toHaveLength(3);for(const w of WorkerMock.instances)w.ready();await Promise.resolve();for(const w of WorkerMock.instances)w.respond('done');await expect(Promise.all(requests)).resolves.toEqual(['done','done','done']);
});

it('discards session review evidence while leaving the signature journal worker available',async()=>{
 vi.stubGlobal('Worker',WorkerMock);
 const prepared=queueCall({operation:'prepare'}),worker=WorkerMock.instances[0]!;
 worker.ready();await Promise.resolve();worker.respond('review');await prepared;
 window.dispatchEvent(new Event('arena-queue-wallet-invalidated'));
 expect(worker.postMessage.mock.calls.at(-1)![0].intent.operation).toBe('invalidate');
 expect(worker.terminate).not.toHaveBeenCalled();
 const retained=queueCall({operation:'retain',id:'review',raw:'signed'});await Promise.resolve();worker.respond('retained');
 await expect(retained).resolves.toBe('retained');
});
it('preserves structured preflight evidence without adding another error prefix',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'prepare'}),worker=WorkerMock.instances[0]!;
 const rejected=expect(pending).rejects.toMatchObject({message:'Verified funding is reserved',details:{code:'creation-funding',available:'1000',reserved:'850000'}});
 worker.ready();await Promise.resolve();worker.onmessage?.({data:{id:worker.postMessage.mock.calls.at(-1)![0].id,error:'Verified funding is reserved',details:{code:'creation-funding',available:'1000',reserved:'850000'}}});await rejected;
});

it('keeps active verification alive beyond 90 seconds and forwards progress without resolving the job',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'prepare'}),worker=WorkerMock.instances[0]!;
 worker.ready();await Promise.resolve();const id=worker.postMessage.mock.calls.at(-1)![0].id;
 for(let i=0;i<24;i++){await vi.advanceTimersByTimeAsync(5000);worker.onmessage?.({data:{type:'heartbeat',id,message:'Verifying blockchain information'}});}
 expect(worker.terminate).not.toHaveBeenCalled();worker.respond('verified');await expect(pending).resolves.toBe('verified');
});

it('retains late signed bytes in the original network worker while blocking new spending after a network switch',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const prepared=queueCall({operation:'prepare'}),worker=WorkerMock.instances[0]!;
 worker.ready();await Promise.resolve();worker.respond('review');await prepared;
 networkState.leaving=true;window.dispatchEvent(new Event('arena-network-leaving'));
 expect(worker.terminate).not.toHaveBeenCalled();
 await expect(queueCall({operation:'submit',id:'old'})).rejects.toThrow('Network changed');
 const retained=queueCall({operation:'retain',id:'old',raw:'signed'});await Promise.resolve();worker.respond('retained');await expect(retained).resolves.toBe('retained');
 expect(WorkerMock.instances).toHaveLength(1);
});

it('background catalog verification cannot overwrite active wallet progress',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const observed=vi.fn(),pending=queueCall({operation:'reportedQueue',channel:'market-0'}),worker=WorkerMock.instances[0]!;
 window.addEventListener('arena-wallet-progress',observed);
 try{worker.ready();await Promise.resolve();worker.onmessage?.({data:{type:'progress',message:'Background verification'}});expect(observed).not.toHaveBeenCalled();worker.respond('ready');await pending;}finally{window.removeEventListener('arena-wallet-progress',observed);}
});

it('cancels obsolete browsing without stopping the other market lane or financial worker',async()=>{
 vi.stubGlobal('Worker',WorkerMock);
 const obsolete=new AbortController();
 const left=queueCall({operation:'reportedQueue',channel:'market-0'},[],obsolete.signal);
 const rejected=expect(left).rejects.toThrow('superseded');
 const right=queueCall({operation:'reportedQueue',channel:'market-1'});
 const financial=queueCall({operation:'prepare'});
 const [a,b,wallet]=WorkerMock.instances;
 for(const worker of [a,b,wallet])worker!.ready();
 await Promise.resolve();
 expect(a!.postMessage).toHaveBeenCalledOnce();
 expect(b!.postMessage).toHaveBeenCalledOnce();
 obsolete.abort();
 await rejected;
 expect(a!.terminate).toHaveBeenCalledOnce();
 expect(b!.terminate).not.toHaveBeenCalled();
 expect(wallet!.terminate).not.toHaveBeenCalled();
 b!.respond('count');wallet!.respond('review');
 await expect(right).resolves.toBe('count');
 await expect(financial).resolves.toBe('review');
});

it('replaces a crashed vault reader without a page refresh',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const read=queueCall({operation:'reportedQueue',config:{}});
 const outcome=expect(read).resolves.toBe('live queue');
 const first=WorkerMock.instances[0]!;
 first.ready();await Promise.resolve();first.onerror?.();
 await vi.advanceTimersByTimeAsync(500);
 const second=WorkerMock.instances[1];
 second?.ready();await Promise.resolve();second?.respond('live queue');
 await outcome;
 expect(first.terminate).toHaveBeenCalledOnce();
});

it('never posts a request aborted between readiness and dispatch',async()=>{
 vi.stubGlobal('Worker',WorkerMock);
 const controller=new AbortController();
 const read=queueCall({operation:'reportedQueue'},[],controller.signal);
 const outcome=expect(read).rejects.toThrow('superseded');
 const worker=WorkerMock.instances[0]!;
 worker.ready();controller.abort();await Promise.resolve();
 expect(worker.postMessage).not.toHaveBeenCalled();
 await outcome;
});

it.each(['startup error','startup timeout','request timeout','transport'])('recovers from %s on the same network',async mode=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const read=queueCall({operation:'reportedQueue'});
 const first=WorkerMock.instances[0]!;
 if(mode==='startup error')first.onerror?.();
 if(mode==='startup timeout')await vi.advanceTimersByTimeAsync(30000);
 if(mode==='request timeout'||mode==='transport'){
  first.ready();await Promise.resolve();
  const id=first.postMessage.mock.calls[0]![0].id;
  if(mode==='transport')first.onmessage?.({data:{id,error:'Electrum disconnected',category:'electrum-transport'}});
  else for(let i=0;i<18;i++){
   first.onmessage?.({data:{id,type:'heartbeat'}});
   await vi.advanceTimersByTimeAsync(5000);
  }
 }
 await vi.advanceTimersByTimeAsync(500);
 expect(first.terminate).toHaveBeenCalledOnce();
 const second=WorkerMock.instances[1]!;
 expect(second.options?.name).toBe('chipnet:selected:read');
 second.ready();await Promise.resolve();second.respond('available');
 await expect(read).resolves.toBe('available');
});

it('cancels backoff on route changes and ignores a late response when browsing subsequent vaults',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const controller=new AbortController();
 const obsolete=queueCall({operation:'reportedQueue',config:'old'},[],controller.signal).catch(error=>error);
 const first=WorkerMock.instances[0]!;
 const late=first.onmessage!;
 first.ready();await Promise.resolve();first.onerror?.();
 await vi.advanceTimersByTimeAsync(100);
 controller.abort();
 expect(await obsolete).toMatchObject({message:expect.stringContaining('superseded')});
 await vi.advanceTimersByTimeAsync(2000);
 expect(WorkerMock.instances).toHaveLength(1);
 const read=queueCall({operation:'reportedQueue',config:'new'}),second=WorkerMock.instances[1]!;
 second.ready();await Promise.resolve();
 late({data:{id:first.postMessage.mock.calls[0]![0].id,result:'obsolete'}});
 second.respond('new vault');await expect(read).resolves.toBe('new vault');
 const next=queueCall({operation:'reportedQueue',config:'next'});
 await Promise.resolve();second.respond('next vault');
 await expect(next).resolves.toBe('next vault');
 expect(WorkerMock.instances).toHaveLength(2);
});

it.each(['mainnet','chipnet'])('cancels old-network backoff before entering %s',async network=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 networkState.network=network==='mainnet'?'chipnet':'mainnet';
 const obsolete=queueCall({operation:'reportedQueue'}).catch(error=>error);
 WorkerMock.instances[0]!.onerror?.();
 await vi.advanceTimersByTimeAsync(100);
 networkState.leaving=true;window.dispatchEvent(new Event('arena-network-leaving'));
 expect(await obsolete).toMatchObject({message:expect.stringContaining('Network changed')});
 await vi.advanceTimersByTimeAsync(2000);
 expect(WorkerMock.instances).toHaveLength(1);
 networkState.leaving=false;networkState.network=network;
 const read=queueCall({operation:'reportedQueue'}),worker=WorkerMock.instances[1]!;
 expect(worker.options?.name).toBe(network+':selected:read');
 worker.ready();await Promise.resolve();worker.respond(network);
 await expect(read).resolves.toBe(network);
});

it('bounds failures, keeps signed journals and wallet RPCs isolated, then accepts a manual retry',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const wallet=queueCall({operation:'retain',id:'existing',raw:'signed-fixture'});
 const journal=queueCall({operation:'list'});
 const read=queueCall({operation:'reportedQueue'}).catch(error=>error);
 const [financial,journals,first]=WorkerMock.instances;
 financial!.ready();journals!.ready();await Promise.resolve();
 window.dispatchEvent(new Event('arena-queue-wallet-invalidated'));
 first!.onerror?.();
 await vi.advanceTimersByTimeAsync(500);
 WorkerMock.instances[3]!.onerror?.();
 await vi.advanceTimersByTimeAsync(1000);
 WorkerMock.instances[4]!.onerror?.();
 expect(await read).toMatchObject({recoveryExhausted:true});
 await vi.advanceTimersByTimeAsync(2000);
 expect(WorkerMock.instances).toHaveLength(5);
 expect(financial!.terminate).not.toHaveBeenCalled();
 expect(journals!.terminate).not.toHaveBeenCalled();
 expect(financial!.postMessage.mock.calls.map(([message])=>message.intent.operation)).toEqual(['retain','invalidate']);
 financial!.onmessage?.({data:{id:financial!.postMessage.mock.calls[0]![0].id,result:'signed'}});
 journals!.respond([{raw:'signed-fixture',stage:'signed'}]);
 await expect(wallet).resolves.toBe('signed');
 await expect(journal).resolves.toEqual([{raw:'signed-fixture',stage:'signed'}]);
 const retry=queueCall({operation:'reportedQueue'});
 const replacement=WorkerMock.instances[5]!;
 replacement.ready();await Promise.resolve();replacement.respond('restored');
 await expect(retry).resolves.toBe('restored');
});

it('shares a replacement when simultaneous journal reads fail',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);
 const reads=[queueCall({operation:'list'}),queueCall({operation:'list'})];
 WorkerMock.instances[0]!.onerror?.();
 await vi.advanceTimersByTimeAsync(500);
 expect(WorkerMock.instances).toHaveLength(2);
 const replacement=WorkerMock.instances[1]!;
 replacement.ready();await Promise.resolve();
 for(const [{id}] of replacement.postMessage.mock.calls)replacement.onmessage?.({data:{id,result:[]}});
 await expect(Promise.all(reads)).resolves.toEqual([[],[]]);
});

it('cancels a journal poll without interrupting a wallet action reading the same journal',async()=>{
 vi.stubGlobal('Worker',WorkerMock);
 const controller=new AbortController();
 const poll=queueCall({operation:'list'},[],controller.signal).catch(error=>error);
 const action=queueCall({operation:'list'});
 const worker=WorkerMock.instances[0]!;
 worker.ready();await Promise.resolve();
 controller.abort();
 expect(await poll).toMatchObject({message:expect.stringContaining('superseded')});
 expect(worker.terminate).not.toHaveBeenCalled();
 worker.respond([{stage:'signed'}]);
 await expect(action).resolves.toEqual([{stage:'signed'}]);
});
