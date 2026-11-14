/** Public/read-only UI check. Wallet connection and every broadcast are prohibited. */
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const target=process.argv[2]??'local',root=fileURLToPath(new URL('../.pages-production',import.meta.url));let server;
if(target==='local'){server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname.replace(/^\/staking-arena-blaze-site\//,''),file=resolve(root,path||'index.html');if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}try{const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(4184,'127.0.0.1',done));}
const url=target==='local'?'http://127.0.0.1:4184/staking-arena-blaze-site/':target;
assert.match(url,/^(http:\/\/127\.0\.0\.1:4184\/staking-arena-blaze-site\/|https:\/\/staking-arena-blaze2026\.github\.io\/staking-arena-blaze-site\/)$/);
const browser=await chromium.launch(launchOptions),errors=[],methods=[];
try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('worker',worker=>{void worker.evaluate(()=>{globalThis.__blazeReads=[];const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){let message;try{message=JSON.parse(String(data));}catch{}if(message?.method){globalThis.__blazeReads.push(message.method);if(message.method==='blockchain.transaction.broadcast')throw Error('Read-only check prohibits broadcasting');}return send.call(this,data);};}).catch(()=>{});});
 await context.routeWebSocket(/wss:\/\//,ws=>{const peer=ws.connectToServer();ws.onMessage(data=>{let message;try{message=JSON.parse(String(data));}catch{}if(message?.method){methods.push(message.method);assert.notEqual(message.method,'blockchain.transaction.broadcast');}peer.send(data);});peer.onMessage(data=>ws.send(data));});
 await page.goto(url+'#/v3');await page.getByRole('heading',{name:'Create a v3 vault'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);
 for(const staking of ['bch','token'])for(const reward of ['bch','token']){await page.getByRole('combobox').nth(0).selectOption(staking);if(staking==='token')await page.getByLabel('Staking category',{exact:true}).fill('ac'.repeat(32));await page.getByRole('combobox').nth(1).selectOption(reward);if(reward==='token')await page.getByLabel('Reward category',{exact:true}).fill('bc'.repeat(32));assert.match(await page.locator('main').innerText(),/verified confirmed or unconfirmed/);}
 await page.getByText('Two-approval creation fallback',{exact:true}).click();assert.match(await page.locator('main').innerText(),/TWO approvals/);assert.match(await page.locator('main').innerText(),/No block confirmation is required/);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('link',{name:'Make an Offer',exact:true}).click();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 await new Promise(resolve=>setTimeout(resolve,5000));for(const worker of page.workers())methods.push(...await worker.evaluate(()=>globalThis.__blazeReads??[]));
 assert.deepEqual(errors,[]);assert.ok(!methods.includes('blockchain.transaction.broadcast'));
 const report={url,verifiedAt:new Date().toISOString(),errors,methods:[...new Set(methods)],fourAssetChoices:true,explicitTwoApprovalFallback:true,mobile:true,reload:true,walletConnected:false,broadcasts:0};
 await writeFile(new URL('../../docs/blaze2026/fast-vault-browser-'+(target==='local'?'local':'deployed')+'.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();if(server)await new Promise(done=>server.close(done));}
