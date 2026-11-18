import {it,expect,vi,afterEach} from 'vitest';
const networkState=vi.hoisted(()=>({leaving:false}));
vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',get networkLeaving(){return networkState.leaving;}}));
import {queueCall} from '../src/queueClient';
class WorkerMock {
 static instances:WorkerMock[]=[];
 onmessage:((e:any)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(){WorkerMock.instances.push(this);}
 ready(){this.onmessage?.({data:{type:'ready'}});}
 respond(result:unknown){this.onmessage?.({data:{id:this.postMessage.mock.calls.at(-1)![0].id,result}});}
}
afterEach(()=>{networkState.leaving=false;window.dispatchEvent(new Event('arena-network-leaving'));WorkerMock.instances=[];vi.useRealTimers();});
it('waits for module/WASM readiness before posting the first request',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'sync',config:{}}),worker=WorkerMock.instances[0]!;
 expect(worker.postMessage).not.toHaveBeenCalled();worker.ready();await Promise.resolve();expect(worker.postMessage).toHaveBeenCalledOnce();worker.respond({verified:true});await expect(pending).resolves.toEqual({verified:true});
});
it('terminates timed-out financial workers and creates a fresh worker for recovery',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',WorkerMock);const pending=queueCall({operation:'submit',id:'retained'}),worker=WorkerMock.instances[0]!;
 const failure=expect(pending).rejects.toThrow('reconcile saved operations');worker.ready();await Promise.resolve();await vi.advanceTimersByTimeAsync(90000);await failure;expect(worker.terminate).toHaveBeenCalledOnce();
 const recovery=queueCall({operation:'resume',id:'retained'}),next=WorkerMock.instances[1]!;expect(next).not.toBe(worker);next.ready();await Promise.resolve();next.respond({retained:true});await expect(recovery).resolves.toEqual({retained:true});
});
it('keeps journal and discovery readers independent of financial work',async()=>{
 vi.stubGlobal('Worker',WorkerMock);const requests=[queueCall({operation:'prepare'}),queueCall({operation:'list'}),queueCall({operation:'sync',channel:'market'})];expect(WorkerMock.instances).toHaveLength(3);for(const w of WorkerMock.instances)w.ready();await Promise.resolve();for(const w of WorkerMock.instances)w.respond('done');await expect(Promise.all(requests)).resolves.toEqual(['done','done','done']);
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
 vi.stubGlobal('Worker',WorkerMock);const observed=vi.fn(),pending=queueCall({operation:'sync',channel:'market'}),worker=WorkerMock.instances[0]!;
 window.addEventListener('arena-wallet-progress',observed);
 try{worker.ready();await Promise.resolve();worker.onmessage?.({data:{type:'progress',message:'Background verification'}});expect(observed).not.toHaveBeenCalled();worker.respond('ready');await pending;}finally{window.removeEventListener('arena-wallet-progress',observed);}
});
