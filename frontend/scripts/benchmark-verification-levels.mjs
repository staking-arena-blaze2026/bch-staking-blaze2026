import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const target=process.argv[2],output=process.argv[3];
if(!target||!output)throw Error('Provide target URL and output report');
const indexFixture=process.env.BENCH_INDEX_FIXTURE?await readFile(process.env.BENCH_INDEX_FIXTURE,'utf8'):undefined;
const report={indexFixture:indexFixture?JSON.parse(indexFixture).revision:undefined,at:new Date().toISOString(),target,wallet:'disconnected',broadcasts:0,rpc:{},errors:[],runs:[]};
let server;const base=new URL(target);
if(base.hostname==='127.0.0.1'){
 const root=resolve('.pages-production');
 server=createServer(async(req,res)=>{try{const file=resolve(root,new URL(req.url,base).pathname.slice(base.pathname.length)||'index.html');if(!file.startsWith(root+'/'))throw Error('Outside build');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(Number(base.port),'127.0.0.1',done));
}
const browser=await chromium.launch(launchOptions);
try{
 for(let run=0;run<2;run++){
  const context=await browser.newContext(),page=await context.newPage();
  if(indexFixture)await context.route('**/public-index/mainnet/index.json',route=>route.fulfill({contentType:'application/json',body:indexFixture}));
  page.on('pageerror',e=>report.errors.push(String(e)));
  await context.addInitScript(()=>{window.__vaultDisplays=[];window.addEventListener('arena-vault-display',e=>window.__vaultDisplays.push({at:performance.now(),genesis:e.detail.snapshot.config.genesis}));});
  await context.routeWebSocket(/wss:\/\//,route=>{const peer=route.connectToServer();route.onMessage(data=>{try{const m=JSON.parse(String(data));if(m.method){report.rpc[m.method]=(report.rpc[m.method]??0)+1;if(m.method==='blockchain.transaction.broadcast'){report.broadcasts++;throw Error('Broadcast forbidden');}}}catch(e){if(String(e).includes('Broadcast forbidden'))throw e;}peer.send(data);});peer.onMessage(data=>route.send(data));});
  const row={run};const start=performance.now();
  await page.goto(target+'#/v3/offers',{waitUntil:'domcontentloaded'});
  await page.locator('.marketplace-table tbody tr').first().waitFor({timeout:15000});row.firstRowMs=performance.now()-start;
  try{await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('.marketplace-table tbody tr')];return rows.length&&rows.every(r=>r.children[1]?.textContent.includes('BCH')||r.children[1]?.textContent.includes('CashToken'));},{},{timeout:60000});row.fullParametersMs=performance.now()-start;}catch(e){row.parametersError=String(e);}
  row.rowCount=await page.locator('.marketplace-table tbody tr').count();row.marketText=await page.locator('.marketplace-table tbody').innerText();
  const link=page.locator('.marketplace-table tbody a').first();const href=await link.getAttribute('href'),detailStart=0;
  await page.goto(target+href,{waitUntil:'domcontentloaded'});
  try{await page.getByRole('heading',{name:'Live ranked queue'}).waitFor({timeout:60000});row.detailDisplayMs=(await page.evaluate(()=>performance.now()))-detailStart;row.singleProviderMs=await page.evaluate(({id,start})=>window.__vaultDisplays.find(v=>v.genesis===id&&v.at>=start)?.at-start,{id:href.split('/').at(-1),start:detailStart});}catch(e){row.detailError=String(e);}
  try{await page.getByText(/Confirmed state verified\.|Pending \(0-conf\) state verified;/).waitFor({timeout:60000});row.independentlyVerifiedMs=(await page.evaluate(()=>performance.now()))-detailStart;}catch(e){row.independentError=String(e);}
  report.runs.push(row);console.log(JSON.stringify(row));await context.close();
 }
}finally{await browser.close();if(server)await new Promise(done=>server.close(done));await writeFile(output,JSON.stringify(report,null,2)+'\n');}
