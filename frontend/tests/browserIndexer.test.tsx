vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',selectedNetwork:()=> 'chipnet',networkLeaving:false,switchNetwork:vi.fn()}));
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { browserConfig, indexerSource } from '../src/browserConfig';
import { useArena } from '../src/useArena';
import { fixture } from './fixture';

afterEach(()=>vi.unstubAllEnvs());
it('defaults static builds to browser Electrum, retains explicit API/off modes and rejects mainnet/unsafe config',()=>{
  expect(indexerSource(null)).toBe('electrum');expect(indexerSource('/api')).toBe('api');
  expect(indexerSource(null,'off')).toBe('off');expect(indexerSource('/api','electrum')).toBe('electrum');
  expect(()=>indexerSource(null,'wrong')).toThrow();
  const config=browserConfig({});expect(config.network).toBe('chipnet');expect(config.endpoints).toHaveLength(3);expect(config.vaults).toHaveLength(1);
  for(const env of [{VITE_ARENA_NETWORK:'mainnet'},{VITE_ELECTRUM_ENDPOINTS:'ws://localhost:50004'},{VITE_ELECTRUM_ENDPOINTS:'wss://user:secret@localhost:50004'},{VITE_ARENA_VAULTS:'[{}]'},{VITE_ELECTRUM_MAX_HISTORY:'0'},{VITE_ELECTRUM_POLL_MS:'1'}]) expect(()=>browserConfig(env)).toThrow();
});
it('uses worker envelopes, labels cached state, displays errors, refreshes and terminates cleanly without HTTP',async()=>{
  vi.stubEnv('VITE_ARENA_VAULTS',JSON.stringify(fixture().vaults.map(v=>v.config)));
  vi.stubEnv('VITE_INDEXER_MODE','electrum');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  let worker: FakeWorker;
  class FakeWorker {
    onmessage?: (event: MessageEvent)=>void;onerror?: (event: ErrorEvent)=>void;
    postMessage=vi.fn();terminate=vi.fn();constructor(){worker=this;}
  }
  vi.stubGlobal('Worker',FakeWorker);
  const hook=renderHook(()=>useArena());
  expect(worker!.postMessage).not.toHaveBeenCalled();
  act(()=>worker!.onmessage?.({data:{type:'ready'}} as MessageEvent));
  expect(worker!.postMessage.mock.calls[0][0].type).toBe('start');
  const data={...fixture(),chain:'chipnet',health:{connected:false,error:'',updatedAt:new Date().toISOString(),stale:true,phase:'Connecting',syncing:true}};
  act(()=>worker!.onmessage?.({data:{type:'snapshot',envelope:data,cached:true,role:'waiting'}} as MessageEvent));
  expect(hook.result.current.fromSnapshot).toBe(true);expect(hook.result.current.pending).toBe(true);
  act(()=>worker!.onmessage?.({data:{type:'snapshot',envelope:{...data,health:{...data.health,connected:true,stale:false,syncing:false,phase:'Synchronized'}},cached:false,role:'follower'}} as MessageEvent));
  await waitFor(()=>expect(hook.result.current.fromSnapshot).toBe(false));expect(hook.result.current.providerStatus).toContain('following another tab');
  act(()=>hook.result.current.refresh());expect(worker!.postMessage).toHaveBeenLastCalledWith({type:'refresh'});
  act(()=>worker!.onmessage?.({data:{type:'error',error:'IndexedDB unavailable'}} as MessageEvent));expect(hook.result.current.error).toContain('IndexedDB unavailable');
  expect(hook.result.current.automatic).toBe(true);expect('setAutomatic' in hook.result.current).toBe(false);
  act(()=>hook.result.current.processPeriod('a'.repeat(64)));expect(worker!.postMessage).toHaveBeenLastCalledWith({type:'process-period',category:'a'.repeat(64)});
  hook.unmount();expect(worker!.terminate).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
});
it('restarts with the complete newly created/imported catalog, ignores old packets, and retains discovery after remount',async()=>{
 vi.stubEnv('VITE_INDEXER_MODE','electrum');
 const workers:FakeWorker[]=[];
 class FakeWorker {onmessage:any;onerror:any;onmessageerror:any;postMessage=vi.fn();terminate=vi.fn();constructor(){workers.push(this);}}
 vi.stubGlobal('Worker',FakeWorker);
 const {saveLocalVault}=await import('../src/vaultCatalog');
 const config={genesis:'a'.repeat(64),stakingCategory:'b'.repeat(64),epoch:1794496500,periodSeconds:300,periods:2,cap:1000};
 const category='c'.repeat(64),hook=renderHook(()=>useArena());
 act(()=>workers[0].onmessage({data:{type:'ready'}}));
 const original=workers[0].postMessage.mock.calls[0][0].config.vaults;
 const late=workers[0].onmessage;
 act(()=>saveLocalVault(config,category));
 expect(workers[0].terminate).toHaveBeenCalledOnce();expect(workers).toHaveLength(2);
 act(()=>workers[1].onmessage({data:{type:'ready'}}));
 expect(workers[1].postMessage.mock.calls[0][0].config.vaults).toEqual([...original,config]);
 act(()=>late({data:{type:'error',error:'obsolete worker error'}}));expect(hook.result.current.error).toBeNull();
 hook.unmount();const remount=renderHook(()=>useArena());
 act(()=>workers[2].onmessage({data:{type:'ready'}}));expect(workers[2].postMessage.mock.calls[0][0].config.vaults).toContainEqual(config);
 expect(JSON.parse(localStorage.getItem('arena-chipnet-local-vaults-v1')!)).toEqual([{category,config}]);remount.unmount();
});
it('recreates failed workers with bounded backoff, reports plain Events, and refresh starts a new worker without deleting storage',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_INDEXER_MODE','electrum');
 const workers:FakeWorker[]=[];class FakeWorker {onmessage:any;onerror:any;onmessageerror:any;postMessage=vi.fn();terminate=vi.fn();constructor(){workers.push(this);}}
 vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:404,headers:{'Content-Type':'text/html'}})));
 localStorage.setItem('wallet-journal-sentinel','preserve');const hook=renderHook(()=>useArena());
 await act(async()=>{workers[0].onerror(new Event('error'));});
 expect(hook.result.current.error).not.toContain('undefined');expect(hook.result.current.error).toContain('404');
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(workers).toHaveLength(2);
 act(()=>workers[1].onerror({message:'WASM resource allocation failed',filename:'crypto.js',lineno:12,colno:4,error:Error('WASM resource allocation failed')}));
 expect(hook.result.current.error).toContain('crypto.js:12:4');expect(hook.result.current.error).toContain('WASM resource allocation failed');
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});expect(workers).toHaveLength(3);
 act(()=>workers[2].onmessageerror(new Event('messageerror')));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(workers).toHaveLength(3);expect(hook.result.current.pending).toBe(false);
 act(()=>hook.result.current.refresh());expect(workers).toHaveLength(4);expect(hook.result.current.pending).toBe(true);
 expect(localStorage.getItem('wallet-journal-sentinel')).toBe('preserve');hook.unmount();vi.useRealTimers();
});
it('responds to another tab importing a vault and surfaces structured bootstrap errors',async()=>{
 vi.stubEnv('VITE_INDEXER_MODE','electrum');let worker:any;let count=0;
 class FakeWorker {onmessage:any;onerror:any;onmessageerror:any;postMessage=vi.fn();terminate=vi.fn();constructor(){worker=this;count++;}}
 vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:200})));
 const hook=renderHook(()=>useArena());
 const config={genesis:'d'.repeat(64),stakingCategory:'b'.repeat(64),epoch:1794496500,periodSeconds:300,periods:2,cap:1000};
 localStorage.setItem('arena-chipnet-local-vaults-v1',JSON.stringify([{category:'e'.repeat(64),config}]));
 act(()=>window.dispatchEvent(new StorageEvent('storage',{key:'arena-chipnet-local-vaults-v1'})));expect(count).toBe(2);
 act(()=>worker.onmessage({data:{type:'ready'}}));expect(worker.postMessage.mock.calls[0][0].config.vaults).toContainEqual(config);
 act(()=>worker.onmessage({data:{type:'error',fatal:true,diagnostic:{message:'Module could not load',filename:'indexer.js',line:9,column:2,stack:'stack: import crypto.js',phase:'module / WASM initialization'}}}));
 expect(hook.result.current.error).toContain('Module could not load');expect(hook.result.current.error).toContain('indexer.js:9:2');expect(hook.result.current.error).toContain('stack: import crypto.js');hook.unmount();
});

it('ignores and removes a saved disable preference and provides no opt-out API',()=>{
 vi.stubEnv('VITE_INDEXER_MODE','electrum');localStorage.setItem('arena-chipnet-automatic-settlement','false');
 let worker:any;class FakeWorker {onmessage:any;onerror:any;onmessageerror:any;postMessage=vi.fn();terminate=vi.fn();constructor(){worker=this;}}
 vi.stubGlobal('Worker',FakeWorker);const hook=renderHook(()=>useArena());act(()=>worker.onmessage({data:{type:'ready'}}));
 expect(localStorage.getItem('arena-chipnet-automatic-settlement')).toBeNull();expect(hook.result.current.automatic).toBe(true);expect(hook.result.current).not.toHaveProperty('setAutomatic');expect(worker.postMessage.mock.calls[0][0]).not.toHaveProperty('automatic');hook.unmount();
});
