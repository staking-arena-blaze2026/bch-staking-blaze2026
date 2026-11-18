import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',networkLeaving:false}));
import {queueCall} from '../src/queueClient';
class WorkerMock {
 static instances:WorkerMock[]=[];
 onmessage:((e:any)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(){WorkerMock.instances.push(this);}
 ready(){this.onmessage?.({data:{type:'ready'}});}
 respond(result:unknown){this.onmessage?.({data:{id:this.postMessage.mock.calls.at(-1)![0].id,result}});}
}
afterEach(()=>{window.dispatchEvent(new Event('arena-network-leaving'));WorkerMock.instances=[];vi.useRealTimers();});
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
