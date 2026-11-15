import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {browserWalletClient} from '../src/browserWalletClient';
import {v3Call} from '../src/v3Client';
vi.mock('../src/v3Client',()=>({v3Call:vi.fn()}));
function setup(reject=false){
 class WorkerMock {onmessage:((event:any)=>void)|null=null;terminate=vi.fn();constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}postMessage(m:any){queueMicrotask(()=>this.onmessage?.({data:{id:m.id,result:m.method==='list'?[]:undefined}}));}}
 vi.stubGlobal('Worker',WorkerMock);
 const publicKey=Uint8Array.of(2,...new Uint8Array(32).fill(1)),owner={publicKey:Array.from(publicKey,x=>x.toString(16).padStart(2,'0')).join('')},request={broadcast:false,userPrompt:'Caller fee approval',transaction:{version:2,inputs:[],outputs:[],locktime:0},sourceOutputs:[]},plan={label:'Claim; caller pays 10000 sats',request,inputPaths:[[3,'receive',0]]};
 const manager=Object.assign(new EventEmitter(),{getSessionPaths:()=>[0,1],hasPath:(p:number)=>p===0||p===1,getPubkey:()=>publicKey,signTransaction:vi.fn(async()=>reject?{error:'User rejected'}:{signedTransaction:'signed'})});
 vi.mocked(v3Call).mockImplementation(async intent=>{if(intent.operation==='claim'||intent.operation==='resume')return {id:'claim',stage:'review',plan};if(intent.operation==='authorize')return {owner,verifiedAt:Date.now(),plan};if(intent.operation==='submit')return {id:'claim',stage:'pending'};return [];});
 return {wallet:browserWalletClient(manager as any,()=>{}),manager,request};
}
it('Cashonize is asked to sign only the fee input with broadcast disabled; worker validates before broadcast',async()=>{
 const {wallet,manager,request}=setup();try{const result=await wallet.v3!({operation:'claim',config:{}});expect(manager.signTransaction).toHaveBeenCalledTimes(1);expect(manager.signTransaction).toHaveBeenCalledWith({transaction:request,inputPaths:[[3,'receive',0]]},{signal:expect.any(AbortSignal)});expect(v3Call).toHaveBeenCalledWith({operation:'submit',id:'claim',raw:'signed'},[]);expect(result.stage).toBe('pending');}finally{wallet.close?.();}
});
it('wallet rejection persists an unsigned error without submitting or automatically retrying',async()=>{
 const {wallet,manager}=setup(true);try{await expect(wallet.v3!({operation:'claim',config:{}})).rejects.toThrow(/refused/);expect(v3Call).toHaveBeenCalledWith({operation:'signingFailed',id:'claim',error:expect.stringContaining('refused')},[]);expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='submit')).toBe(false);expect(manager.signTransaction).toHaveBeenCalledTimes(1);}finally{wallet.close?.();}
});
it('reconciling a signed uncertain claim never requests another wallet signature',async()=>{
 const {wallet,manager}=setup();vi.mocked(v3Call).mockResolvedValue({id:'claim',raw:'signed',stage:'prepared'});try{await wallet.v3!({operation:'resume',id:'claim'});expect(manager.signTransaction).not.toHaveBeenCalled();}finally{wallet.close?.();}
});

it('rejects worker authorization that enables wallet broadcasting before Cashonize is called',async()=>{
 const {wallet,manager}=setup();const previous=vi.mocked(v3Call).getMockImplementation()!;vi.mocked(v3Call).mockImplementation(async (...args)=>{const result=await previous(...args);if(args[0].operation==='authorize')result.plan.request.broadcast=true;return result;});try{await expect(wallet.v3!({operation:'claim',config:{}})).rejects.toThrow(/broadcasting must remain disabled/);expect(manager.signTransaction).not.toHaveBeenCalled();}finally{wallet.close?.();}
});

it('create vault scans the change chain, and a receive-only session cannot hide those UTXOs',async()=>{
 const {wallet}=setup();
 try{
  await wallet.v3!({operation:'create',parameters:{}});
  const passed=vi.mocked(v3Call).mock.calls.find(([intent])=>intent.operation==='create')?.[1] as {path:string;index:number}[];
  expect(passed.filter(key=>key.path==='change').map(key=>key.index)).toEqual([...Array(40).keys()]);
 }finally{wallet.close?.();}
 const receiveOnly=Object.assign(new EventEmitter(),{getSessionPaths:()=>[0],hasPath:(p:number)=>p===0,getPubkey:()=>Uint8Array.of(2,...new Uint8Array(32).fill(1)),signTransaction:vi.fn()});
 const hidden=browserWalletClient(receiveOnly as any,()=>{});
 await expect(hidden.v3!({operation:'create',parameters:{}})).rejects.toThrow(/change addresses/);
 hidden.close?.();
});

it('direct creation requests one Cashonize approval for every selected wallet input',async()=>{
 const {wallet,manager}=setup();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async (...args)=>{if(args[0].operation==='create'){const result=await original({operation:'claim'});result.plan.inputPaths=[[0,'receive',0],[1,'change',2]];return result;}return original(...args);});
 try{await wallet.v3!({operation:'create',parameters:{}});expect(manager.signTransaction).toHaveBeenCalledTimes(1);expect(manager.signTransaction).toHaveBeenCalledWith({transaction:expect.objectContaining({broadcast:false}),inputPaths:[[0,'receive',0],[1,'change',2]]},{signal:expect.any(AbortSignal)});}finally{wallet.close?.();}
});

it('a changed canonical state rejects authorization before Cashonize signing',async()=>{
 const {wallet,manager}=setup();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{if(args[0].operation==='authorize')throw Error('Vault state changed; review a fresh transaction');return original(...args);});
 try{await expect(wallet.v3!({operation:'claim',config:{}})).rejects.toThrow(/state changed/);expect(manager.signTransaction).not.toHaveBeenCalled();expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='submit')).toBe(false);}finally{wallet.close?.();}
});

it('two-approval fallback never authorizes its child automatically',async()=>{
 const {wallet,manager}=setup();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>args[0].operation==='createLegacy'?original({operation:'claim'}):original(...args));
 try{
  await wallet.v3!({operation:'createLegacy',parameters:{}});expect(manager.signTransaction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(v3Call).mock.calls.some(([intent])=>intent.operation==='resume')).toBe(false);
  await wallet.v3!({operation:'resume',id:'claim'});expect(manager.signTransaction).toHaveBeenCalledTimes(2);
 }finally{wallet.close?.();}
});

it('covenant-controlled chained creation still requests only one Cashonize approval',async()=>{
 const {wallet,manager}=setup();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{
  if(args[0].operation==='create'){const result=await original({operation:'claim'});result.creationMode='chained';result.plan.inputPaths=[[0,'receive',0],[1,'change',1]];result.plan.label='Create vault with one approval via covenant-controlled preparation';return result;}
  if(args[0].operation==='submit')return {id:'chained',stage:'pending',creationMode:'chained',funding:'11'.repeat(32),txid:'22'.repeat(32)};
  return original(...args);
 });
 try{await wallet.v3!({operation:'create',parameters:{}});expect(manager.signTransaction).toHaveBeenCalledTimes(1);expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='resume')).toBe(false);}finally{wallet.close?.();}
});
it('expanding discovery does not authorize or broadcast a transaction',async()=>{
 const {wallet,manager}=setup();try{expect(await wallet.v3!({operation:'expandScan'})).toMatch(/200 addresses/);expect(manager.signTransaction).not.toHaveBeenCalled();expect(vi.mocked(v3Call).mock.calls.some(([i])=>i.operation==='create'||i.operation==='submit')).toBe(false);}finally{wallet.close?.();}
});

it('invalidates preparation across a transport interruption even when the same identity returns',async()=>{
 const {wallet,manager}=setup();const original=vi.mocked(v3Call).getMockImplementation()!;
 vi.mocked(v3Call).mockImplementation(async(...args)=>{const result=await original(...args);if(args[0].operation==='authorize'){manager.emit('reconnecting');}return result;});
 try{await expect(wallet.v3!({operation:'claim'})).rejects.toThrow(/authorization changed/);expect(manager.signTransaction).not.toHaveBeenCalled();expect(vi.mocked(v3Call).mock.calls.some(([intent])=>intent.operation==='submit')).toBe(false);}finally{wallet.close?.();}
});
it('obsolete workers cannot authorize new transactions after being closed',async()=>{
 const {wallet,manager}=setup();wallet.close?.();
 await expect(wallet.v3!({operation:'claim'})).rejects.toThrow(/closed/);
 expect(manager.signTransaction).not.toHaveBeenCalled();
});
