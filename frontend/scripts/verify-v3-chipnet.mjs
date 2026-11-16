/** Exercise the compiled UI and public read-only chipnet connections. Never connect a wallet. */
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const local=process.argv[2]==='--local',url=local?'http://127.0.0.1:4181/staking-arena-site/':process.argv[2]??'https://scinklja.github.io/staking-arena-site/';
async function connection(page){
 for(let attempt=0;attempt<3;attempt++){
  if(attempt)await page.getByRole('button',{name:'Check read-only network connection'}).click();
  await page.getByTestId('v3-network').filter({hasText:/Verified chipnet identity|Network unavailable/}).waitFor({timeout:35000});
  const status=await page.getByTestId('v3-network').innerText();console.log(status);
  if(status.startsWith('Verified chipnet identity'))return;
 }
 throw Error('Chipnet read-only connection failed after three explicit refreshes');
}
let server;
if(local){const root=resolve(process.argv[3]??'dist');server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,path.replace(/^\/staking-arena-site\//,'')||'index.html');if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}try{const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(4181,'127.0.0.1',done));}
let browser,activePage;
try{
 browser=await chromium.launch(launchOptions);const context=await browser.newContext(),page=await context.newPage(),errors=[],workers=[],methods=[],responses=[];
 activePage=page;
 page.on('pageerror',e=>errors.push(e.message));page.on('worker',w=>{workers.push(w.url());void w.evaluate(()=>{globalThis.__arenaReadonlyMethods=[];const original=WebSocket.prototype.send;WebSocket.prototype.send=function(data){let m;try{m=JSON.parse(String(data));}catch{}if(m?.method){globalThis.__arenaReadonlyMethods.push(m.method);if(m.method==='blockchain.transaction.broadcast')throw Error('Read-only browser check refuses transaction broadcasting');}return original.call(this,data);};}).catch(()=>{});});page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url(),status:r.status()});});
 await context.routeWebSocket(/wss:\/\//,ws=>{const peer=ws.connectToServer();ws.onMessage(data=>{let m;try{m=JSON.parse(data.toString());}catch{}if(m?.method){methods.push(m.method);assert.notEqual(m.method,'blockchain.transaction.broadcast','Read-only verification must never broadcast');}peer.send(data);});peer.onMessage(data=>ws.send(data));});
 console.log('Opening compiled v3 page',url);await page.goto(url+'#/v3',{waitUntil:'domcontentloaded'});await page.getByRole('combobox',{name:'Staking asset',exact:true}).waitFor();await connection(page);
 console.log('Initial chipnet connection verified');
 assert.match(await page.locator('body').innerText(),/Each new offer exchanges one reward payment for one independent stake lock/);
 assert.match(await page.locator('body').innerText(),/Direct creation uses one Cashonize approval and one transaction/);
 await page.getByText('Two-stage creation fallback',{exact:true}).waitFor();
 for(const w of page.workers())methods.push(...await w.evaluate(()=>globalThis.__arenaReadonlyMethods??[]));
 const status=await page.getByTestId('v3-network').innerText();assert.match(await page.locator('body').innerText(),/Experimental — Chipnet test funds only/);assert.doesNotMatch(await page.locator('main').innerText(),/regtest/i);
 const pairs=[];for(const stake of ['bch','token'])for(const reward of ['bch','token']){await page.getByRole('combobox').nth(0).selectOption(stake);if(stake==='token')await page.getByLabel('Staking category',{exact:true}).fill('ac'.repeat(32));await page.getByRole('combobox').nth(1).selectOption(reward);if(reward==='token')await page.getByLabel('Reward category',{exact:true}).fill('bc'.repeat(32));assert.equal(await page.getByRole('button',{name:'Review full reserve funding in wallet'}).isDisabled(),true);pairs.push(stake+'-'+reward);}
 assert.equal(await page.getByRole('button',{name:'Connect Wallet',exact:true}).count(),1);
 await page.getByRole('link',{name:'Make an Offer',exact:true}).click();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 assert.match(await page.locator('body').innerText(),/Every action verifies current blockchain state automatically/);
 assert.equal(await page.getByRole('link',{name:'Make an Offer',exact:true}).getAttribute('aria-current'),'page');
 await page.goBack();await page.getByRole('combobox',{name:'Staking asset',exact:true}).waitFor();await page.goForward();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('link',{name:'Create a Vault',exact:true}).click();await page.getByRole('combobox',{name:'Staking asset',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.setViewportSize({width:1360,height:1000});
 console.log('Four creation asset choices, tabs, history, and mobile widths verified; reloading');
 await page.reload({waitUntil:'domcontentloaded'});await connection(page);
 console.log('Reload chipnet connection verified; checking v1/v2 navigation');
 await page.getByRole('link',{name:'V2 vaults & recovery'}).click();await page.getByRole('heading',{name:/v2/i}).first().waitFor();
 await page.getByRole('link',{name:'Vaults',exact:true}).click();await page.getByRole('heading',{name:'Stake Arena',exact:true}).waitFor();await page.getByRole('link',{name:'Create Vault',exact:true}).click();await page.getByRole('heading',{name:/Create/}).first().waitFor();
 for(const w of page.workers())methods.push(...await w.evaluate(()=>globalThis.__arenaReadonlyMethods??[]));
 assert.deepEqual(errors,[]);assert.deepEqual(responses,[]);assert(methods.includes('blockchain.block.header'));assert.equal(methods.includes('blockchain.transaction.broadcast'),false);
 const result={verifiedAt:new Date().toISOString(),url,status,pairs,v3Reload:true,tabsAndHistory:true,mobileWidth:true,v1Accessible:true,v2Accessible:true,directGenesisOneApproval:true,walletConnected:false,walletSigningVerified:false,broadcasts:0,pageErrors:errors,httpErrors:responses,workers,electrumMethods:[...new Set(methods)]};
 await writeFile(resolve('../docs/'+(local?'staking-arena-v3-ui-browser-local.json':'staking-arena-v3-ui-browser-public.json')),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){if(activePage)console.error((await activePage.locator('body').innerText()).slice(0,7000));throw error;}finally{await browser?.close();if(server)await new Promise(done=>server.close(done));}
