import {test,expect,type Page} from '@playwright/test';
import {SettlementChain,settlementConfig} from '../../../tests/fixtures/settlement-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
let chain:SettlementChain,disconnectAfterAccept=false,holdResponses:Promise<void>|undefined;
const cert=mkdtempSync(tmpdir()+'/arena-settlement-wss-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',cert+'/key','-out',cert+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(cert+'/key'),cert:readFileSync(cert+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',(socket,request)=>socket.on('message',async frame=>{
 const data=JSON.parse(frame.toString());
 try {
  if(holdResponses)await holdResponses;
  if(chain.disagree&&request.headers.host?.startsWith('localhost')&&data.method==='blockchain.scripthash.get_history'){socket.send(JSON.stringify({id:data.id,result:[]}));return;}
  const result=await chain.request(data.method,...data.params);
  if(disconnectAfterAccept&&data.method==='blockchain.transaction.broadcast'){disconnectAfterAccept=false;socket.close();return;}
  socket.send(JSON.stringify({id:data.id,result}));
 }catch(error){socket.send(JSON.stringify({id:data.id,error:{code:-1,message:String(error)}}));}
}));server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const s of sockets.clients)s.terminate();sockets.close();server.close();await once(server,'close');rmSync(cert,{recursive:true,force:true});});
test.beforeEach(()=>{chain=new SettlementChain();disconnectAfterAccept=false;holdResponses=undefined;});
const category=()=>chain.transactions.get(settlementConfig.genesis)!.vin[0]!.txid;
async function open(page:Page){await page.goto(`http://127.0.0.1:4176/settlement/#/vault/${category()}`);}
const status=(page:Page)=>page.getByTestId('settlement-status');
test.fixme('mandatory automation ignores saved false, needs no wallet interaction and processes confirmed periods sequentially',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('arena-chipnet-automatic-settlement','false');(window as any).walletMethods=[];const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message:any,...rest:any[]){if(message?.method)(window as any).walletMethods.push(message.method);if(message?.type==='start'){const result=original.call(this,{...message,automatic:false},...rest as []);original.call(this,{type:'keeper-settings',automatic:false});return result;}return original.call(this,message,...rest as []);};});
 await open(page);
 await expect(page.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();expect(await page.getByRole('checkbox').count()).toBe(0);
 for(const action of [2,3,2,3]){
  await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);const id=[...chain.pending][0]!,tx=chain.transactions.get(id)!;
  const {transitionWitness}=await import('../../../src/arena-core');expect(transitionWitness(tx.vin[0]!.scriptSig.hex).action).toBe(action);
  for(const input of tx.vin)expect(chain.confirmed.has(input.txid)).toBe(true);
  const count=chain.broadcasts.length;await page.waitForTimeout(1200);expect(chain.broadcasts.length).toBe(count);
  chain.mine();
 }
 await expect(page.getByText('Completed — all periods processed on-chain',{exact:true})).toBeVisible({timeout:30000});
 expect(chain.broadcasts.length).toBe(4);expect(await page.evaluate(()=>localStorage.getItem('arena-chipnet-automatic-settlement'))).toBe('false');
 expect(await page.evaluate(()=>(window as any).walletMethods.some((method:string)=>['authorize','submit','offer'].includes(method)))).toBe(false);
});
test.fixme('two independent browsers converge on a single pending canonical transaction',async({browser,page})=>{
 const other=await browser.newContext({ignoreHTTPSErrors:true}),second=await other.newPage();
 try{await Promise.all([open(page),open(second)]);await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);await expect(status(second)).toContainText(/Pending confirmation|reconciling|retrying/,{timeout:30000});expect(new Set(chain.broadcasts).size).toBe(1);expect(chain.broadcasts.length).toBeLessThanOrEqual(2);}
 finally{await other.close();}
});
test.fixme('reload preserves pending intents and tab leadership transfer resumes without a control',async({context,page})=>{
 disconnectAfterAccept=true;await open(page);await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);await page.reload();await expect(status(page)).toContainText('Pending confirmation',{timeout:30000});expect(chain.broadcasts.length).toBe(1);
 const second=await context.newPage();await open(second);await expect(status(second)).toContainText('Pending confirmation',{timeout:30000});await page.close();chain.mine();
 await expect.poll(()=>chain.broadcasts.length,{timeout:30000}).toBe(2);expect(chain.pending.size).toBe(1);expect(chain.confirmed.has(chain.transactions.get([...chain.pending][0]!)!.vin[0]!.txid)).toBe(true);
});
test.fixme('provider contradiction prevents all automatic broadcasts and recovery starts without a toggle',async({page})=>{
 chain.disagree=true;await open(page);await expect(status(page)).toContainText('disagreement',{timeout:30000});expect(chain.broadcasts.length).toBe(0);chain.disagree=false;
 await expect.poll(()=>chain.pending.size,{timeout:30000}).toBe(1);
});

// Frozen consensus policy supersedes the historical automatic-spending expectations above.
test('chipnet period processing stays read-only even when the synthetic providers agree',async({page})=>{
 await open(page);await expect(page.getByText(/Chipnet temporarily unavailable for transactions:/)).toBeVisible();
 await expect(status(page)).toContainText('Chipnet temporarily unavailable',{timeout:60000});expect(chain.broadcasts).toHaveLength(0);expect(chain.pending.size).toBe(0);
 await expect(page.getByRole('button',{name:'Process Period',exact:true})).toBeDisabled();
});
