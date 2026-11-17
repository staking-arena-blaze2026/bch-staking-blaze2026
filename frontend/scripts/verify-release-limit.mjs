import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const local=process.argv.includes('--local'),target=local?'http://127.0.0.1:5184/staking-arena-blaze-site/':'https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const evidence=resolve('../docs/blaze2026/release-limit');await mkdir(evidence,{recursive:true});
let server;
if(local){const root=resolve('.pages-production');server=createServer(async(req,res)=>{try{const path=new URL(req.url,target).pathname.slice(new URL(target).pathname.length),file=resolve(root,path||'index.html');if(!file.startsWith(root+'/'))throw Error('Invalid path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(5184,'127.0.0.1',done));}
const browser=await chromium.launch(launchOptions),context=await browser.newContext(),page=await context.newPage();
const report={at:new Date().toISOString(),target,local,walletConnected:false,transactionsSigned:0,broadcasts:[],errors:[],counts:[]};
page.on('pageerror',e=>report.errors.push(e.message));
// Independently block transaction broadcasts on every worker's Electrum connection.
await context.routeWebSocket(/wss:\/\//,route=>{const peer=route.connectToServer();route.onMessage(data=>{let m;try{m=JSON.parse(String(data));}catch{}if(m?.method==='blockchain.transaction.broadcast'){report.broadcasts.push(m.method);throw Error('Read-only verification prohibits broadcasts');}try{peer.send(data);}catch{/* A page can close while a relay packet is in flight. */}});peer.onMessage(data=>{try{route.send(data);}catch{/* Closed page. */}});});
page.setDefaultTimeout(30000);
try{
 await page.goto(target+'#/v3');await page.getByLabel('Number of releases (1–1000)').waitFor();
 await page.getByLabel('Schedule starts (local time)').fill('2027-01-01T00:00:00');await page.getByLabel('Interval (minutes)').fill('1440');
 for(const n of [1,16,17,100,365,1000]){await page.getByLabel('Number of releases (1–1000)').fill(String(n));const reserve=await page.getByText('Deposit the entire reserve upfront:',{exact:false}).innerText(),duration=await page.getByText('Vault duration:',{exact:false}).innerText();assert.ok(reserve.includes((n*0.00002).toFixed(8)+' BCH'));assert.ok(duration.includes(n.toFixed(2)+' days'));report.counts.push({count:n,reserve,duration});}
 assert.equal(await page.getByLabel('Number of releases (1–1000)').getAttribute('max'),'1000');
 await page.getByLabel('Number of releases (1–1000)').fill('1001');assert.match(await page.getByRole('alert').innerText(),/whole number from 1 to 1000/);assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);report.rejects1001=true;
 await page.getByLabel('Number of releases (1–1000)').fill('1000');await page.screenshot({path:resolve(evidence,local?'local-create.png':'live-create.png'),fullPage:true});
 const pairing=await context.newPage();pairing.on('pageerror',e=>report.errors.push(e.message));await pairing.goto(target+'#/v3');await pairing.getByRole('button',{name:'Connect Wallet',exact:true}).click();await pairing.getByRole('dialog').waitFor();assert.match(await pairing.getByLabel('Connection URI').inputValue(),/^wiz:\/\//i);report.walletPairingDialog=true;
 await page.getByRole('link',{name:'Make an Offer',exact:true}).click();await page.locator('.marketplace-table tbody tr').first().waitFor();report.discoveredRows=await page.locator('.marketplace-table tbody tr').count();assert.ok(report.discoveredRows>0);
 const old='c14b3170fd156ee0b5cdefba0241981407a481caa08d7169b2e07ea5caccb2e5';
 await page.locator('a[href="#/v3/vault/'+old+'"]').click();await page.getByRole('heading',{name:'Live ranked queue'}).waitFor({timeout:120000});
 await page.getByText('Confirmed state verified.',{exact:false}).waitFor({timeout:120000});report.confirmedLegacyVault=old;report.legacySummary=await page.locator('.v3-summary').innerText();
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.broadcasts,[]);
 console.log(JSON.stringify(report,null,2));
}finally{await writeFile(resolve(evidence,local?'local-browser.json':'live-browser.json'),JSON.stringify(report,null,2)+'\n');await browser.close();if(server)await new Promise(done=>server.close(done));}
