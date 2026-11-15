// Fresh browser context; public chain reads only. No wallet pairing or spending.
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const target=process.argv[2]??'http://127.0.0.1:4184/staking-arena-blaze-site/';
const base=new URL(target),root=resolve('.pages-production');let server;
if(base.hostname==='127.0.0.1'){
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,base).pathname;if(!path.startsWith(base.pathname))throw Error('Invalid path');const file=resolve(root,path.slice(base.pathname.length)||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside build');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));
}
const report={at:new Date().toISOString(),target,walletConnected:false,broadcasts:[],errors:[],networks:{},sockets:[]};
let browser;
try{
 browser=await chromium.launch(launchOptions);const context=await browser.newContext();
 await context.routeWebSocket(/wss:\/\//,ws=>{report.sockets.push(ws.url());const peer=ws.connectToServer();ws.onMessage(data=>{let m;try{m=JSON.parse(data.toString());}catch{}if(m?.method==='blockchain.transaction.broadcast'){report.broadcasts.push(ws.url());throw Error('Read-only test refuses broadcasts');}peer.send(data);});peer.onMessage(data=>ws.send(data));});
 const page=await context.newPage();page.on('worker',w=>{void w.evaluate(()=>{globalThis.__arenaRequests=[];const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){let m;try{m=JSON.parse(String(data));}catch{}if(m?.method){globalThis.__arenaRequests.push({endpoint:this.url,method:m.method});if(m.method==='blockchain.transaction.broadcast')throw Error('Read-only browser refuses broadcast');}return send.call(this,data);};}).catch(()=>{});});page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(20000);
 await page.goto(target+'#/v3',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Create a v3 vault'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Network',exact:true}).inputValue(),'mainnet');
 await page.getByText(/mainnet providers verified · height/).waitFor({timeout:60000});
 const chipnet=JSON.parse(await readFile('public/v3-vaults.json','utf8'));
 await page.evaluate(async catalog=>{localStorage.setItem('staking-arena-v3-configs-chipnet',JSON.stringify(catalog.vaults));localStorage.setItem('arena-chipnet-recovery-sentinel','retained');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('staking-arena-wallet-v3-chipnet',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const t=db.transaction('operations','readwrite');t.objectStore('operations').put({id:'chipnet-recovery-sentinel',error:'chipnet-recovery-sentinel',kind:'create',step:'complete',stage:'confirmed',parameters:catalog.vaults[0]},'chipnet-recovery-sentinel');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();},chipnet);
 report.networks.mainnet={verified:await page.locator('.v3-arena>.provider-status').innerText(),createRequiresWallet:await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled()};
 const workerReads=await Promise.all(page.workers().map(w=>w.evaluate(()=>({network:globalThis.name,requests:globalThis.__arenaRequests??[]}))));report.networks.mainnet.workerReads=workerReads;const initialSockets=workerReads.flatMap(w=>w.requests.map(r=>r.endpoint));assert(new Set(initialSockets).size>=2);assert(initialSockets.every(s=>/bch\.(loping\.net|imaginary\.cash)/.test(s)));
 await page.getByRole('link',{name:'Make an Offer',exact:true}).click();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:/fa5bae/}).count(),0);assert.equal(await page.getByText('chipnet-recovery-sentinel',{exact:false}).count(),0);
 await page.getByRole('combobox',{name:'Network',exact:true}).selectOption('chipnet');await page.waitForURL(/network=chipnet/);
 await page.getByText(/Chipnet temporarily unavailable for transactions:/).waitFor();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 await page.getByRole('link',{name:/V3 vault fa5bae/}).waitFor();await page.getByText('Transaction recovery',{exact:true}).click();await page.getByText(/chipnet-recovery-sentinel/).waitFor({timeout:90000});
 await page.getByRole('link',{name:'Create a Vault',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 report.networks.chipnet={temporarilyUnavailable:true,knownVaultRetained:true,journalRetained:true,createDisabled:true,mobileFits:true};
 await page.getByRole('combobox',{name:'Network',exact:true}).selectOption('mainnet');await page.waitForURL(/network=mainnet/);await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('arena-chipnet-recovery-sentinel')),'retained');assert.equal(await page.getByRole('link',{name:/fa5bae/}).count(),0);assert.equal(await page.getByText(/chipnet-recovery-sentinel/).count(),0);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Network',exact:true}).inputValue(),'mainnet');
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));assert.equal(report.broadcasts.length,0);report.roundTripSeparation=true;report.status='passed';
 console.log('PASS dual-network production browser: mainnet identity, chipnet listings/recovery, switching, reload, mobile, zero broadcasts');
}catch(error){report.status='failed';report.failure=String(error);throw error;}
finally{await writeFile(process.env.DUAL_NETWORK_REPORT??'../docs/blaze2026/dual-network-browser.json',JSON.stringify(report,null,2)+'\n');await browser?.close();if(server)await new Promise(done=>server.close(done));}
