import {test,expect} from '@playwright/test';
import {queueBrowserChain} from '../../../tests/fixtures/queue-browser-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
const directory=mkdtempSync(tmpdir()+'/queue-browser-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',directory+'/key','-out',directory+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(directory+'/key'),cert:readFileSync(directory+'/cert')}),sockets=new WebSocketServer({server});
let fixture:ReturnType<typeof queueBrowserChain>,methods:string[]=[],hosts=new Set<string>();
let gate:Promise<void>|undefined;
let disconnects=0;
const interrupted=new WeakSet<object>();
const blocked=new Set<unknown>();
test.beforeAll(async()=>{sockets.on('connection',(socket,req)=>{hosts.add(req.headers.host??'');socket.on('message',async data=>{const m=JSON.parse(String(data));methods.push(m.method);if(interrupted.has(socket))return;if(disconnects>0&&m.method==='blockchain.scripthash.listunspent'){interrupted.add(socket);disconnects--;socket.terminate();return;}if(gate&&m.method==='blockchain.scripthash.listunspent'){blocked.add(socket);await gate;}try{socket.send(JSON.stringify({id:m.id,result:await fixture.chain.request(m.method,...m.params)}));}catch(e){socket.send(JSON.stringify({id:m.id,error:{code:-1,message:String(e)}}));}});});server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();server.close();await once(server,'close');rmSync(directory,{recursive:true,force:true});});
test('real workers render metadata before parallel WSS reads and reconcile owner history',async({page,context})=>{
 fixture=queueBrowserChain();const errors:string[]=[];const workerErrors:string[]=[];page.on('console',m=>{if(m.text().startsWith('QUEUE_WORKER_ERROR:'))workerErrors.push(m.text());});await page.addInitScript(()=>{const Original=Worker;window.Worker=class extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',e=>{if(e.data.error)console.error('QUEUE_WORKER_ERROR:'+e.data.error);});}};});page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket(/^wss:\/\/relay\./,s=>s.onMessage(()=>{}));
 const network='regtest',updatedAt=new Date().toISOString(),second={...fixture.config,anchor:{...fixture.config.anchor,genesis:'ee'.repeat(32)}};
 await page.route('**/public-index/queue/regtest/index.json',route=>route.fulfill({json:JSON.parse(JSON.stringify({network,vaults:[fixture.config,second].map(c=>({...c,offerCount:{network,vaultId:c.anchor.genesis,waiting:3,updatedAt}})),pages:[]},(_,v)=>typeof v==='bigint'?v.toString():v))}));
 let release!:()=>void;
 gate=new Promise<void>(resolve=>{release=resolve;});
 await page.goto('./#/v3/offers');
 const vault=page.getByRole('link',{name:'Vault 1',exact:true});
 const cells=page.locator('.marketplace-table tbody tr td:last-child');
 try{
  await expect(cells).toHaveText(['3','3']);
  await expect.poll(()=>blocked.size,{timeout:60000}).toBeGreaterThanOrEqual(2);
  expect(methods).not.toContain('blockchain.transaction.get_merkle');
 }finally{gate=undefined;release();}
 await expect(cells).toHaveText(['1','1'],{timeout:30000});
 await vault.click();await expect(page).toHaveURL(new RegExp('#/v3/vault/'+fixture.config.anchor.genesis+'$'));
 await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible({timeout:80000});await expect(page.getByRole('button',{name:'Claim reward'})).toBeDisabled();
 await expect(page.getByRole('region',{name:'Vault details'}).getByRole('button',{name:'Claim reward'})).toBeVisible();await expect(page.getByRole('heading',{name:'Claim',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Queue',exact:true})).toBeVisible();
 await page.getByLabel('Lock duration (time units)').fill('12');await expect(page.getByText(/1 hour, 42 minutes, 24 seconds/)).toBeVisible();
 await page.getByText('Release schedule and history').click({timeout:45000});await expect(page.getByRole('columnheader',{name:'Scheduled local time'})).toBeVisible();

 for(const width of [320,390,768,1024,1672]){await page.setViewportSize({width,height:1000});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow,'page overflow at '+width).toBe(false);const offer=await page.locator('.queue-offer-panel').boundingBox(),queue=await page.locator('.queue-queue-panel').boundingBox();if(width>850){expect(queue!.x).toBeGreaterThan(offer!.x);expect(Math.abs(queue!.y-offer!.y)).toBeLessThan(1);}else expect(queue!.y).toBeGreaterThanOrEqual(offer!.y+offer!.height);}
 await page.evaluate(({owner,xpub})=>localStorage.setItem('staking-arena-wizardconnect-v1-regtest',JSON.stringify({
  walletPublicKey:owner.slice(2),privateKey:'01'.repeat(32),secret:'02'.repeat(8),paths:[{name:'receive',xpub}],
 })),{owner:fixture.config.anchor.creator,xpub:fixture.xpub});
 // Keep the saved pairing offline while allowing loopback Electrum requests.
 await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'onLine',{configurable:true,get:()=>false}));
 await page.reload();
 const active=page.locator('.queue-my-offers article strong').filter({hasText:'Waiting'});
 await expect(active).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();
 await fixture.claim();await page.reload();
 await expect(page.locator('.queue-my-offers article strong').filter({hasText:'Locked'})).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Get my stake back'})).toHaveCount(0);
 await page.getByRole('button',{name:'Locked',exact:true}).click();
 for(const width of [320,390,1672]){
  await page.setViewportSize({width,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.getByRole('link',{name:'Create Vault',exact:true}).click();await expect(page.getByLabel('Release interval (minutes)')).toBeVisible();await page.getByRole('link',{name:'About',exact:true}).click();await expect(page.getByRole('heading',{name:/Stake Arena/}).first()).toBeVisible();
 expect(hosts.has('127.0.0.1:4177')&&hosts.has('localhost:4177')).toBe(true);expect(methods).toContain('blockchain.transaction.get_merkle');expect(methods).not.toContain('blockchain.transaction.broadcast');expect(errors).toEqual([]);

});

test('a vault recovers after a module load failure and both Electrum peers disconnect',async({page})=>{
 fixture=queueBrowserChain();
 disconnects=2;
 const network='regtest';
 const first=fixture.config;
 const second={...first,anchor:{...first.anchor,genesis:'ee'.repeat(32)}};
 const vaults=JSON.parse(JSON.stringify([first,second],(_,v)=>typeof v==='bigint'?v.toString():v));
 await page.route('**/public-index/queue/regtest/index.json',route=>route.fulfill({json:{network,vaults,pages:[]}}));
 await page.route('**/*?failQueueStartup=1',route=>route.abort());
 await page.addInitScript(()=>{
  const Original=Worker;
  let inject=true;
  window.Worker=class extends Original {
   constructor(url:string|URL,options?:WorkerOptions){
    const target=new URL(url,location.href);
    if(inject&&options?.name==='regtest:selected:read'){
     inject=false;
     target.searchParams.set('failQueueStartup','1');
    }
    super(target,options);
   }
  };
 });
 const reports:{event:string;category?:string;channel:string}[]=[];
 page.on('console',async message=>{
  if(message.text().startsWith('Queue worker')&&message.args()[1]){
   reports.push(await message.args()[1]!.jsonValue());
  }
 });
 try {
  await page.goto('./#/v3/vault/'+first.anchor.genesis);
  const details=page.getByRole('region',{name:'Vault details'});
  await expect(details.getByText('Published configuration')).toBeVisible();
  await expect(details.getByText('Remaining reserve')).toBeVisible({timeout:30000});
  await expect(page.getByRole('region',{name:'Queue',exact:true}).getByText(/1 waiting/)).toBeVisible();
  expect(disconnects).toBe(0);
  await expect.poll(()=>reports.filter(report=>report.channel==='selected').map(({event,category})=>category??event)).toEqual([
   'startup','electrum-transport','recovered',
  ]);
  await page.getByRole('link',{name:'← All vaults',exact:true}).click();
  await page.getByRole('link',{name:'Vault 2',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(second.anchor.genesis+'$'));
  await expect(details.getByText('Remaining reserve')).toBeVisible({timeout:30000});
 } finally {
  disconnects=0;
 }
});
