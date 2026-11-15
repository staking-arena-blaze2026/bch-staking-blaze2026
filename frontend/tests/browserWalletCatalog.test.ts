vi.mock('../src/activeNetwork',()=>({activeNetwork:'chipnet',selectedNetwork:()=> 'chipnet',networkLeaving:false,switchNetwork:vi.fn()}));
import {expect,it,vi} from 'vitest';
import {browserWalletClient} from '../src/browserWalletClient';
import {localVaultRecords} from '../src/vaultCatalog';
import type {WalletOperation} from '../../src/browser-wallet';
const pending:WalletOperation={version:1,network:'chipnet',id:'pending-genesis',kind:'create',step:'genesis',stage:'pending',observation:'submitted',parameters:{stakingCategory:'11'.repeat(32),epoch:1800000000,periodSeconds:60,periods:2,cap:1000},coins:[],txid:'22'.repeat(32),genesis:'22'.repeat(32),pregenesis:'33'.repeat(32),updatedAt:0};
function client(operations:WalletOperation[]){
 const methods:string[]=[];
 class WorkerMock {
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:unknown;terminate=vi.fn();
  constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}} as MessageEvent));}
  postMessage(message:any){methods.push(message.method);const result=message.method==='list'?operations:['get','advance'].includes(message.method)?pending:undefined;queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result}} as MessageEvent));}
 }
 vi.stubGlobal('Worker',WorkerMock);
 return {wallet:browserWalletClient(null,()=>{}),methods};
}
it('remembers a submitted genesis candidate before confirmation without completing or importing it',async()=>{
 const {wallet,methods}=client([pending]);
 try{const result=await wallet.execute({kind:'resume',id:pending.id});expect(result.operation?.stage).toBe('pending');expect(localVaultRecords()).toEqual([{category:pending.pregenesis,config:{...pending.parameters,genesis:pending.genesis}}]);expect(methods).not.toContain('importVault');}finally{wallet.close?.();}
});
it('reload recovers pending genesis candidates from the journal and excludes funded factories',async()=>{
 const factory={...pending,id:'factory',step:'funding' as const,genesis:undefined,pregenesis:undefined,txid:'44'.repeat(32)};
 const {wallet}=client([factory,pending]);
 try{await vi.waitFor(()=>expect(localVaultRecords()).toHaveLength(1));expect(localVaultRecords()[0].config.genesis).toBe(pending.genesis);expect(localVaultRecords()[0].category).toBe(pending.pregenesis);}finally{wallet.close?.();}
});
it('requires a live wallet before preparing public v2 creation',async()=>{
 const {wallet,methods}=client([]);
 try{await expect(wallet.v2!({operation:'create',parameters:{}})).rejects.toThrow(/Connect a chipnet wallet first/);expect(methods).not.toContain('v2');}finally{wallet.close?.();}
});
