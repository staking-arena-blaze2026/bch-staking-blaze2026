import {afterEach,expect,it,vi} from 'vitest';
class WorkerMock {
 static all:WorkerMock[]=[];onmessage:((event:any)=>void)|null=null;onerror:(()=>void)|null=null;
 sent:any[]=[];terminate=vi.fn();
 constructor(){WorkerMock.all.push(this);queueMicrotask(()=>this.reply({type:'ready'}));}
 postMessage(m:any){this.sent.push(m);}
 reply(data:any){this.onmessage?.({data});}
 finish(result:any){this.reply({id:this.sent.at(-1).id,result});}
}
afterEach(()=>{window.dispatchEvent(new Event('arena-network-leaving'));vi.useRealTimers();vi.unstubAllGlobals();});
async function setup(){vi.resetModules();WorkerMock.all=[];vi.stubGlobal('Worker',WorkerMock);return import('../src/v3Client');}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
it('selected sync, discovery verification and journal reads cannot queue ahead of a financial call',async()=>{
 const {v3Call,verifyMarketplace}=await setup();
 const sync=v3Call({operation:'sync',config:{}}),market=verifyMarketplace({},0),list=v3Call({operation:'list'});await flush();
 const create=v3Call({operation:'create'});await flush();expect(WorkerMock.all).toHaveLength(4);
 const financial=WorkerMock.all.find(w=>w.sent[0]?.intent.operation==='create')!;financial.finish({stage:'review'});
 await expect(create).resolves.toEqual({stage:'review'});
 for(const w of WorkerMock.all.filter(w=>w!==financial))w.finish([]);await Promise.all([sync,market,list]);
});
it('uses one serialized financial worker for retention and submission',async()=>{
 const {v3Call}=await setup();const retain=v3Call({operation:'retainSigned'});await flush();const w=WorkerMock.all[0]!;w.finish('retained');await retain;
 const submit=v3Call({operation:'submit'});await flush();expect(WorkerMock.all).toHaveLength(1);w.finish('pending');await expect(submit).resolves.toBe('pending');
});
it('stage timeout terminates execution, ignores late responses and starts a new recoverable worker',async()=>{
 vi.useFakeTimers();const {v3Call}=await setup();const submit=v3Call({operation:'submit'});await flush();const w=WorkerMock.all[0]!;
 w.reply({type:'stage',id:w.sent[0].id,stage:'broadcast'});const rejected=expect(submit).rejects.toThrow(/broadcast timed out; reconcile/);
 await vi.advanceTimersByTimeAsync(50000);await rejected;expect(w.terminate).toHaveBeenCalledTimes(1);
 w.finish('late broadcast result');const list=v3Call({operation:'list'});await flush();const next=WorkerMock.all[1]!;next.finish(['journal retained']);await expect(list).resolves.toEqual(['journal retained']);
});
it('long active verification survives the old 120 second limit and progresses by stage',async()=>{
 vi.useFakeTimers();const {v3Call}=await setup();const offer=v3Call({operation:'offer'});await flush();const w=WorkerMock.all[0]!;
 w.reply({type:'stage',id:w.sent[0].id,stage:'vault-state-replay'});await vi.advanceTimersByTimeAsync(125000);expect(w.terminate).not.toHaveBeenCalled();
 w.reply({type:'stage',id:w.sent[0].id,stage:'input-verification'});await vi.advanceTimersByTimeAsync(60000);w.finish({stage:'review'});await expect(offer).resolves.toEqual({stage:'review'});
});
it('network departure cancels every transport and rejects all pending requests',async()=>{
 const {v3Call,verifyMarketplace}=await setup();const jobs=[v3Call({operation:'create'}),v3Call({operation:'sync'}),v3Call({operation:'list'}),verifyMarketplace({},1)];const results=Promise.allSettled(jobs);await flush();window.dispatchEvent(new Event('arena-network-leaving'));
 expect((await results).every(r=>r.status==='rejected')).toBe(true);expect(WorkerMock.all.every(w=>w.terminate.mock.calls.length===1)).toBe(true);
});
it('provider status cannot delay the first vault snapshot and changing vault cancels a stuck read',async()=>{
 const {v3Call}=await setup();
 const status=v3Call({operation:'connect'}),first=v3Call({operation:'sync',config:{genesis:'a'}});const rejected=expect(first).rejects.toThrow(/Selected vault changed/);
 await flush();expect(WorkerMock.all).toHaveLength(2);
 const second=v3Call({operation:'sync',config:{genesis:'b'}});await flush();await rejected;
 expect(WorkerMock.all[1].terminate).toHaveBeenCalledOnce();
 WorkerMock.all[2].finish({snapshot:'b'});await expect(second).resolves.toEqual({snapshot:'b'});
 WorkerMock.all[0].finish({network:'mainnet'});await status;
});
