import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const target=process.argv[2]??'https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const report={at:new Date().toISOString(),target,freshContext:true,walletConnected:false,storagePrepopulated:false,errors:[],reads:[],rpc:[],broadcasts:[],runs:[]};
let server;const base=new URL(target);if(base.hostname==='127.0.0.1'){const root=resolve('.pages-production');server=createServer(async(req,res)=>{try{const url=new URL(req.url,base);const file=resolve(root,url.pathname.slice(base.pathname.length)||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside build');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));}
const browser=await chromium.launch(launchOptions),context=await browser.newContext();
report.browser=await browser.version();
await context.routeWebSocket(/wss:\/\//,route=>{const peer=route.connectToServer();route.onMessage(data=>{let m;try{m=JSON.parse(String(data));}catch{}if(m?.method){report.rpc.push({endpoint:route.url(),method:m.method,params:m.params});if(m.method==='blockchain.transaction.broadcast'){report.broadcasts.push(route.url());throw Error('Read-only acceptance refuses broadcast');}}peer.send(data);});peer.onMessage(data=>route.send(data));});
const page=await context.newPage();report.userAgent=await page.evaluate(()=>navigator.userAgent);
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('worker',w=>{void w.evaluate(()=>{const send=WebSocket.prototype.send;globalThis.__reads=[];WebSocket.prototype.send=function(data){const m=JSON.parse(String(data));globalThis.__reads.push({method:m.method,params:m.params});if(m.method==='blockchain.transaction.broadcast')throw Error('Read-only test refuses broadcast');return send.call(this,data);};}).catch(()=>{});});
try{
 for(let run=0;run<(process.env.BENCH_BEFORE?'1':'2');run++){
 const start=performance.now();if(run===0)await page.goto(target+'#/v3/offers',{waitUntil:'domcontentloaded'});else await page.reload({waitUntil:'domcontentloaded'});
 const row={run};try{await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).waitFor({timeout:process.env.BENCH_BEFORE?60000:15000});row.listMs=performance.now()-start;row.candidateText=await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).innerText();}catch(e){row.listError=String(e);row.elapsedMs=performance.now()-start;}
 if(!process.env.BENCH_BEFORE&&row.listMs){try{await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).getByText('Verified snapshot',{exact:false}).waitFor({timeout:120000});row.verifiedMs=performance.now()-start;row.verifiedText=await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).innerText();if(run===0&&process.env.BENCH_SCREENSHOT)await page.screenshot({path:process.env.BENCH_SCREENSHOT,fullPage:true});}catch(e){row.verificationError=String(e);}}
 report.runs.push(row);report.reads.push(...await Promise.all(page.workers().map(w=>w.evaluate(()=>({network:globalThis.name,reads:globalThis.__reads??[]})).catch(()=>({closed:true})))));
 }
 if(!process.env.BENCH_BEFORE){await page.getByRole('combobox',{name:'Network',exact:true}).selectOption('chipnet');await page.waitForURL(/network=chipnet/);await page.locator('.v3-vault-card').filter({hasText:'fa5bae8625e61ec1'}).waitFor({timeout:15000});report.chipnetSeparated=await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).count()===0;await page.getByRole('combobox',{name:'Network',exact:true}).selectOption('mainnet');await page.waitForURL(/network=mainnet/);await page.locator('.v3-vault-card').filter({hasText:'c14b3170fd156ee0'}).waitFor();report.mainnetSeparated=await page.locator('.v3-vault-card').filter({hasText:'fa5bae8625e61ec1'}).count()===0;}
 report.resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('public-index')).map(r=>({url:r.name,ms:r.duration,bytes:r.transferSize})));
 report.storage=await page.evaluate(()=>Object.keys(localStorage));
}finally{await writeFile(process.env.BENCH_REPORT??'../docs/blaze2026/marketplace-after.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.runs,null,2));await browser.close();if(server)await new Promise(done=>server.close(done));}
