import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const browser=await chromium.launch(launchOptions),context=await browser.newContext();
const report={at:new Date().toISOString(),readOnly:true,walletConnected:false,requests:{},timings:[],broadcastAttempts:0};
await context.routeWebSocket(/wss:\/\//,route=>{const server=route.connectToServer();route.onMessage(data=>{const m=JSON.parse(String(data));if(m.method){report.requests[m.method]=(report.requests[m.method]??0)+1;if(m.method==='blockchain.transaction.broadcast'){report.broadcastAttempts++;throw Error('Broadcast prohibited');}}server.send(data);});server.onMessage(data=>route.send(data));});
const page=await context.newPage();
page.on('worker',worker=>{void worker.evaluate(()=>{const send=WebSocket.prototype.send;globalThis.__rpcCounts={};WebSocket.prototype.send=function(data){const m=JSON.parse(String(data));if(m.method){globalThis.__rpcCounts[m.method]=(globalThis.__rpcCounts[m.method]??0)+1;if(m.method==='blockchain.transaction.broadcast')throw Error('Read-only browser probe refuses broadcast');}return send.call(this,data);};}).catch(()=>{});});
try{
 await page.goto('http://127.0.0.1:5174/#/v3',{waitUntil:'domcontentloaded'});
 const index=JSON.parse(await readFile(new URL('../public/public-index/mainnet/index.json',import.meta.url),'utf8')),config=index.vaults.find(v=>v.config.registryVersion===4).config;
 report.result=await page.evaluate(async config=>{
  const {v3Call,verifyMarketplace,cancelMarketplaceReads}=await import('/src/v3Client');
  config.cap=BigInt(config.cap);const times=[];window.addEventListener('arena-wallet-timing',e=>times.push(e.detail));
  const coldStarted=performance.now();try{await v3Call({operation:'authorize',id:'read-only-no-such-operation'});}catch{}const coldFinancialStartupMs=performance.now()-coldStarted;
  const reads=[v3Call({operation:'sync',config}),verifyMarketplace(config,0)];const settled=Promise.allSettled(reads);
  await new Promise(r=>setTimeout(r,150));const start=performance.now();let error='';
  try{await v3Call({operation:'authorize',id:'read-only-no-such-operation'});}catch(e){error=String(e);}
  const financialQueueProbeMs=performance.now()-start;const results=await settled;cancelMarketplaceReads();
  return {coldFinancialStartupMs,financialQueueProbeMs,error,readResults:results.map(r=>r.status),times};
 },config);
 report.workerRequests=await Promise.all(page.workers().map(w=>w.evaluate(()=>globalThis.__rpcCounts??{}).catch(()=>({}))));
 if(!report.result.error.includes('not awaiting unsigned wallet approval'))throw Error('Unexpected local-only authorization result');
 if(report.result.financialQueueProbeMs>5000)throw Error('Financial queue delayed by background reads');
 if(report.broadcastAttempts)throw Error('Read-only probe attempted a broadcast');
 await writeFile(new URL('../../docs/blaze2026/transaction-browser-concurrency.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({coldStartupMs:report.result.coldFinancialStartupMs,financialQueueProbeMs:report.result.financialQueueProbeMs,readResults:report.result.readResults,workerRequests:report.workerRequests}));
}finally{await browser.close();}
