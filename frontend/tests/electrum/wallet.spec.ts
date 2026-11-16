import {test,expect,type Page} from '@playwright/test';
import {WalletFixture} from '../../../tests/fixtures/wallet-chain';
import {settlementConfig} from '../../../tests/fixtures/settlement-chain';
import {parseExtendedJson} from '@wizardconnect/core';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
let fixture:WalletFixture;
const dir=mkdtempSync(tmpdir()+'/arena-wallet-wss-');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key','-out',dir+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(dir+'/key'),cert:readFileSync(dir+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',socket=>socket.on('message',async frame=>{const message=JSON.parse(frame.toString());try{const result=await fixture.chain.request(message.method,...message.params);socket.send(JSON.stringify({id:message.id,result}));}catch(error){socket.send(JSON.stringify({id:message.id,error:{code:-1,message:String(error)}}));}}));server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();server.close();await once(server,'close');rmSync(dir,{recursive:true,force:true});});
test.beforeEach(()=>{fixture=new WalletFixture();});
async function start(page:Page){
 // Isolate native wallet tests from the page's independent automatic keeper.
 await page.route('**/wallet-worker-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Wallet worker test</title>'}));
 await page.goto('/wallet-worker-test');const file=readdirSync('.static-test/settlement/assets').find(f=>f.startsWith('wallet.worker-'))!;expect(file).toBeTruthy();
 await page.evaluate(async({file,config})=>{const worker=new Worker('/settlement/assets/'+file,{type:'module'}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let sequence=0;
  (window as any).walletCall=(method:string,...args:unknown[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});
  await new Promise<void>((resolve,reject)=>{worker.onmessage=event=>{if(event.data.type==='ready'){resolve();return;}const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);event.data.error?task.reject(Error(event.data.error)):task.resolve(event.data.result);};worker.onerror=e=>reject(Error(e.message));});
  await (window as any).walletCall('start',config);
 },{file,config:{network:'chipnet',vaults:[settlementConfig],endpoints:['wss://127.0.0.1:4177','wss://localhost:4177'],timeoutMs:10000,pollMs:1000,maxHistoryEntries:1000,maxTransactions:1000,maxRawBytes:16777216,tabId:'fixture-wallet'}});
}
async function call(page:Page,method:string,...args:unknown[]){const encoded=await page.evaluate(async({method,args})=>{const result=await (window as any).walletCall(method,...args);return JSON.stringify(result,(_k,v)=>typeof v==='bigint'?`<bigint: ${v}n>`:v instanceof Uint8Array?`<Uint8Array: 0x${[...v].map(x=>x.toString(16).padStart(2,'0')).join('')}>`:v);},{method,args});return parseExtendedJson(encoded);}
test.fixme('native wallet worker persists signed factory intent, resumes after reload and admits confirmed genesis',async({page})=>{
 await start(page);const balances=await call(page,'scan',fixture.keys);expect(balances.tokens[fixture.asset]).toBe('2500');let op=await call(page,'create',fixture.parameters(),fixture.keys);const signed=fixture.sign(op.plan);op=await call(page,'submit',op.id,signed,fixture.keys);expect(op.stage).toBe('pending');const id=op.id;
 const blocked=await page.evaluate(async id=>navigator.locks.request('arena-chipnet-wallet-submission',async()=>{
  try {await (window as any).walletCall('get',id);return false;}catch(error){return String(error).includes('Another tab');}
 }),id);expect(blocked).toBe(true);
 expect((await call(page,'list')).find((o:any)=>o.id===id).raw).toBe(signed);
 await page.reload();await start(page);expect((await call(page,'list')).find((o:any)=>o.id===id).raw).toBe(signed);fixture.chain.mine();op=await call(page,'advance',id,[]);expect(op.step).toBe('genesis');fixture.chain.mine();op=await call(page,'get',id);expect(op.step).toBe('complete');expect(op.config.genesis).toBe(op.genesis);expect(fixture.chain.broadcasts).toHaveLength(2);
});
test('native wallet worker reserves unsigned funding, permits explicit discard and refuses changed signed outputs',async({page})=>{
 await start(page);await call(page,'scan',fixture.keys);let op=await call(page,'create',fixture.parameters(),fixture.keys);await expect(call(page,'create',fixture.parameters(),fixture.keys)).rejects.toThrow(/Insufficient BCH/);op=await call(page,'cancel',op.id);expect(op.stage).toBe('cancelled');op=await call(page,'create',fixture.parameters(),fixture.keys);op.plan.request.transaction.outputs[0].valueSatoshis--;const raw=fixture.sign(op.plan);await expect(call(page,'submit',op.id,raw,fixture.keys)).rejects.toThrow(/changed/);expect(fixture.chain.broadcasts).toHaveLength(0);
});

for(const pair of ['token-bch','bch-token','token-token','bch-bch','same-category'])test.fixme(`v2 native worker ${pair}: reserve, offer, keeper and allocation withdrawal`,async({page})=>{
 test.setTimeout(180000);await start(page);
 const token={kind:'token',category:fixture.asset},other={kind:'token',category:fixture.other},native={kind:'bch'},stakingAsset=pair.startsWith('bch')?native:token,rewardAsset=pair==='same-category'?token:pair.endsWith('bch')?native:other;
 const parameters={version:2,stakingAsset,rewardAsset,cap:rewardAsset.kind==='bch'?2000n:10n,periods:2,epoch:fixture.chain.clock().mtp-10000,periodSeconds:10};
 const v2=(intent:Record<string,unknown>)=>call(page,'v2',intent,fixture.keys);
 async function finish(op:any){expect(op.stage).toBe('review');op=await v2({operation:'submit',id:op.id,raw:fixture.sign(op.plan)});expect(op.stage).toBe('pending');fixture.chain.mine();op=await v2({operation:'resume',id:op.id});expect(op.step).toBe('action');expect(op.stage).toBe('review');op=await v2({operation:'submit',id:op.id,raw:fixture.sign(op.plan)});expect(op.stage).toBe('pending');fixture.chain.mine();op=await v2({operation:'resume',id:op.id});expect(op.step).toBe('complete');return op;}
 const created=await finish(await v2({operation:'create',parameters})),config=created.config;
 await finish(await v2({operation:'offer',config,terms:{stake:1000n,duration:1,reward:rewardAsset.kind==='bch'?1000n:7n,maxWins:2}}));
 await finish(await v2({operation:'keeper',config}));await finish(await v2({operation:'keeper',config}));
 const snapshot=await v2({operation:'sync',config});expect(snapshot.version).toBe(2);expect(snapshot.allocations).toHaveLength(1);expect(snapshot.pending).toHaveLength(0);expect(snapshot.allocations[0].mature).toBe(true);
 await finish(await v2({operation:'keeper',config}));const activated=await v2({operation:'sync',config});expect(activated.instance.state[4]).toBe(1);
 await finish(await v2({operation:'withdraw',config,allocation:snapshot.allocations[0].id}));const withdrawn=await v2({operation:'sync',config});expect(withdrawn.allocations[0].withdrawal).toBeTruthy();expect(withdrawn.instance.inputs[0].txid).toBe(activated.instance.inputs[0].txid);
 expect((await v2({operation:'list'})).filter((o:any)=>o.step==='complete')).toHaveLength(6);
});

for(const minimum of [0,1])test(`mock Electrum browser: pending genesis visibility at threshold ${minimum}, reload and confirmation keep one listing`,async({page})=>{
 // Construct locally signed transactions against the offline protocol fixture.
 // Every Electrum request is served by the loopback WSS server above.
 await fixture.engine.scan(fixture.keys);
 let op=await fixture.engine.create(fixture.parameters(),fixture.keys);
 op=await fixture.engine.submit(op.id,fixture.sign(op.plan!),fixture.keys);
 fixture.chain.mine();op=await fixture.engine.advance(op.id,fixture.keys);
 const config={...op.parameters,genesis:op.genesis!},category=op.pregenesis!;
 await page.addInitScript(({config,category,minimum})=>{
  localStorage.setItem('arena-chipnet-local-vaults-v1',JSON.stringify([{config,category}]));
  const original=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message:any,...rest:any[]){
   return original.call(this,message?.type==='start'?{...message,config:{...message.config,minDisplayConfirmations:minimum}}:message,...rest as []);
  };
 },{config,category,minimum});
 await page.goto('/settlement/#/v1');
 await expect(page.getByTestId('electrum-status')).toContainText('Synchronized',{timeout:60000});
 const listing=page.locator(`a.vault-row[href="#/vault/${category}"]`);
 if(minimum===0){await expect(listing).toContainText('Unconfirmed (0-conf)');}else await expect(listing).toHaveCount(0);
 await page.reload();await expect(page.getByTestId('electrum-status')).toContainText('Synchronized',{timeout:60000});
 await expect(listing).toHaveCount(minimum===0?1:0);
 fixture.chain.mine();await page.getByRole('button',{name:'Refresh data',exact:true}).click();
 await expect(listing).toHaveCount(1,{timeout:60000});await expect(listing).toContainText('Confirmed');await expect(listing).not.toContainText('Unconfirmed');
 await page.reload();await expect(listing).toHaveCount(1,{timeout:60000});await expect(listing).toContainText('Confirmed');
});

// Public chipnet is frozen. Historical success cases above remain for the consensus upgrade.
test('chipnet freeze prevents native-worker broadcast and retains signed recovery bytes',async({page})=>{
 await start(page);await call(page,'scan',fixture.keys);const op=await call(page,'create',fixture.parameters(),fixture.keys),signed=fixture.sign(op.plan);
 const result=await call(page,'submit',op.id,signed,fixture.keys);expect(result.error).toContain('Chipnet temporarily unavailable');expect(fixture.chain.broadcasts).toHaveLength(0);
 await page.reload();await start(page);expect((await call(page,'list')).find((o:any)=>o.id===op.id).raw).toBe(signed);expect(fixture.chain.broadcasts).toHaveLength(0);
});
