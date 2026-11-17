import {test,expect} from '@playwright/test';
import {queueBrowserChain} from '../../../tests/fixtures/queue-browser-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
const directory=mkdtempSync(tmpdir()+'/queue-browser-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',directory+'/key','-out',directory+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(directory+'/key'),cert:readFileSync(directory+'/cert')}),sockets=new WebSocketServer({server});
let fixture:ReturnType<typeof queueBrowserChain>,methods:string[]=[],hosts=new Set<string>();
test.beforeAll(async()=>{sockets.on('connection',(socket,req)=>{hosts.add(req.headers.host??'');socket.on('message',async data=>{const m=JSON.parse(String(data));methods.push(m.method);try{socket.send(JSON.stringify({id:m.id,result:await fixture.chain.request(m.method,...m.params)}));}catch(e){socket.send(JSON.stringify({id:m.id,error:{code:-1,message:String(e)}}));}});});server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();server.close();await once(server,'close');rmSync(directory,{recursive:true,force:true});});
test('real workers authenticate queue genesis over two WSS providers, retain owner history, and render mobile layouts',async({page,context})=>{
 fixture=queueBrowserChain();const errors:string[]=[];const workerErrors:string[]=[];page.on('console',m=>{if(m.text().startsWith('QUEUE_WORKER_ERROR:'))workerErrors.push(m.text());});await page.addInitScript(()=>{const Original=Worker;window.Worker=class extends Original{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',e=>{if(e.data.error)console.error('QUEUE_WORKER_ERROR:'+e.data.error);});}};});page.on('pageerror',e=>errors.push(e.message));await context.routeWebSocket(/^wss:\/\/relay\./,s=>s.onMessage(()=>{}));
 await page.route('**/public-index/queue/regtest/index.json',route=>route.fulfill({json:JSON.parse(JSON.stringify({network:'regtest',vaults:[fixture.config],pages:[]},(_,v)=>typeof v==='bigint'?v.toString():v))}));
 await page.goto('./#/v3/offers');const vault=page.getByRole('link',{name:'Vault 1',exact:true});await expect(vault).toBeVisible();await expect(page.locator('.marketplace-table tbody td').last()).toHaveText('1',{timeout:80000}).catch(e=>{throw Error(String(e)+'; '+JSON.stringify({workerErrors,methods:[...new Set(methods)],hosts:[...hosts]}));});await vault.click();await expect(page).toHaveURL(new RegExp('#/v3/vault/'+fixture.config.anchor.genesis+'$'));
 await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible({timeout:80000});await expect(page.getByRole('button',{name:'Claim reward'})).toBeDisabled();
 await page.getByLabel('Lock duration (time units)').fill('12');await expect(page.getByText(/1 hour, 42 minutes, 24 seconds/)).toBeVisible();
 await page.getByText('Release schedule and history').click();await expect(page.getByRole('columnheader',{name:'Scheduled local time'})).toBeVisible();
 const evidence=[];mkdirSync('../docs/blaze2026/linked-queue',{recursive:true});
 for(const width of [320,390,768,1024,1672]){await page.setViewportSize({width,height:1000});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow,'page overflow at '+width).toBe(false);evidence.push({width,overflow});if(width===390)await page.screenshot({path:'../docs/blaze2026/linked-queue/vault-mobile.png',fullPage:true});}
 await page.evaluate(owner=>localStorage.setItem('staking-arena-queue-owner-regtest',owner),fixture.config.anchor.creator);await page.goto('./#/v3/my-offers');await page.reload();await expect(page.locator('.queue-my-offers article strong').filter({hasText:'Waiting'})).toBeVisible({timeout:80000});
 await fixture.claim();await page.reload();await expect(page.locator('.queue-my-offers article strong').filter({hasText:'Baked'})).toBeVisible({timeout:80000});await expect(page.getByRole('button',{name:'Get my stake back'})).toBeDisabled();
 await page.getByRole('link',{name:'Create Vault',exact:true}).click();await expect(page.getByLabel('Release interval (minutes)')).toBeVisible();await page.getByRole('link',{name:'About',exact:true}).click();await expect(page.getByRole('heading',{name:/Stake Arena/}).first()).toBeVisible();
 expect(hosts.has('127.0.0.1:4177')&&hosts.has('localhost:4177')).toBe(true);expect(methods).toContain('blockchain.transaction.get_merkle');expect(methods).not.toContain('blockchain.transaction.broadcast');expect(errors).toEqual([]);
 writeFileSync('../docs/blaze2026/linked-queue/browser-results.json',JSON.stringify({at:new Date().toISOString(),synthetic:true,hosts:[...hosts],methods:[...new Set(methods)],errors,viewports:evidence},null,2)+'\n');
});
