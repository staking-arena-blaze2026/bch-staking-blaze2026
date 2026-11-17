// Read-only browser QA. Synthetic public identities and snapshots never authorize spending.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {launchOptions} from './browser-options.mjs';
import assert from 'node:assert/strict';
const remote=process.argv[2],root=resolve('.pages-production'),prefix='/staking-arena-blaze-site/';
const server=remote?undefined:createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,path.slice(prefix.length)||'index.html');
 if(!path.startsWith(prefix)||!file.startsWith(root+'/')){res.writeHead(404).end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
if(server)await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=remote??`http://127.0.0.1:${server.address().port}${prefix}`;
const browser=await chromium.launch(launchOptions),errors=[],report={url:base,at:new Date().toISOString(),synthetic:true,liveWallet:false};
try{
 const context=await browser.newContext({viewport:{width:1100,height:900}});
 await context.routeWebSocket(/^wss?:\/\//,socket=>socket.close());
 const owner='02'+'11'.repeat(32),other='03'+'22'.repeat(32),genesis='ab'.repeat(32);
 const config={version:3,registryVersion:4,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:3600,periods:4,cap:'2000',genesis};
 const state=Buffer.alloc(794);state[5]=6;state.writeUInt32LE(8000,790);
 for(let slot=0;slot<6;slot++){const start=6+slot*49;state.set(Buffer.from(slot===5?other:owner,'hex'),start);state.writeUInt32LE(3000,start+33);state.writeUInt32LE(3600,start+37);state.writeUInt32LE(1000,start+41);state[start+45]=1;if(slot>=1&&slot<=3)state[start+46]=1;if(slot===4){state[start+47]=1;state[start+48]=1;}}
 const allocations=[1,2,3].map(slot=>{const terms=Buffer.alloc(110);terms.set(Buffer.from(owner,'hex'));terms[65]=slot;terms.writeUInt32LE(3000,70);terms.writeUInt32LE(0x400008,74);return {id:`win${slot}:4`,terms:{data:[...terms]},sourceMtp:1800000000,mature:slot!==1,input:{txid:`win${slot}`,vout:4,satoshis:'3000'},...(slot===3?{withdrawal:'confirmed-withdrawal'}:{})};});
 const snapshot={version:3,config,instance:{state:{data:[...state]},inputs:[]},clock:{height:100,mtp:1800005000},pending:[],allocations,history:[],offerHistory:[],tip:{height:100,hash:'00'.repeat(32)},endpoint:'synthetic'};
 await context.addInitScript(({owner,config,snapshot})=>{
  localStorage.setItem('arena-my-offers-owner-mainnet',owner);
  localStorage.setItem('staking-arena-v3-configs-mainnet',JSON.stringify([config]));
  localStorage.setItem('staking-arena-v3-configs-mainnet-snapshots',JSON.stringify({[config.genesis]:{snapshot,at:1}}));
 },{owner,config,snapshot});
 // Public discovery remains available; Electrum is intentionally offline for retained-view QA.
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+'#/v3/my-offers');await page.getByRole('heading',{name:'My Offers',exact:true}).waitFor();
 await page.getByText(/Last connected wallet/).waitFor();
 const text=await page.locator('main').innerText();for(const status of ['ACTIVE','WON / LOCKED','BAKED','FINISHED','CANCELLED'])assert.ok(text.includes(status),status);
 assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Get my stake back',exact:true}).count(),1);
 assert.ok(!text.includes('Offer 6'));await page.getByRole('button',{name:'Get my stake back',exact:true}).click();await page.getByRole('status').filter({hasText:/Open Cashonize/}).waitFor();
 await page.evaluate(async({config,owner})=>{
  const request=indexedDB.open('staking-arena-wallet-v3-mainnet',1);request.onupgradeneeded=()=>request.result.createObjectStore('operations');
  const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const parameters={...config,cap:BigInt(config.cap)},op={id:'synthetic-unsigned',version:3,network:'mainnet',kind:'offer',step:'action',stage:'review',signing:'rejected',owner:{publicKey:owner,path:'receive',index:0},config:parameters,parameters};
  await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readwrite');tx.objectStore('operations').put(op,op.id);tx.objectStore('operations').put({...op,id:'synthetic-signed',raw:'synthetic-retained-bytes',txid:'cd'.repeat(32),signing:'requested',stage:'prepared'},'synthetic-signed');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 },{config,owner});
 await page.reload();await page.getByText(/Last connected wallet/).waitFor();
 const recovery=page.locator('details.panel').filter({has:page.locator('summary',{hasText:'Transaction recovery'})});await recovery.locator('summary').first().click();
 await page.getByRole('button',{name:'Discard unsigned operation',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Discard unsigned operation',exact:true}).count(),1);
 assert.ok(await page.getByRole('button',{name:'Reconcile transaction status'}).isEnabled());assert.ok(await page.getByRole('button',{name:'Retry identical transaction',exact:true}).isEnabled());
 await page.getByRole('button',{name:'Discard unsigned operation',exact:true}).click();await page.getByText(/Unsigned operation discarded; journal retained/).waitFor();
 assert.equal(await page.getByRole('button',{name:'Discard unsigned operation',exact:true}).count(),0);report.offlineDiscard=true;report.signedRecoveryRetained=true;
 report.offlineReload=true;report.fiveStatuses=true;report.ownershipFilter=true;report.offlineAuthorizationPrompt=true;
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));report.mobileFits=true;
 const out=resolve('../docs/blaze2026/my-offers');await mkdir(out,{recursive:true});await page.screenshot({path:out+(remote?'/deployed-mobile.png':'/local-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);report.errors=errors;await writeFile(out+(remote?'/deployed-browser.json':'/local-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();if(server)await new Promise(done=>server.close(done));}
