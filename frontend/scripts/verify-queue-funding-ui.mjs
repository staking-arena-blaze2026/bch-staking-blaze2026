/** Fresh-profile, no-wallet UI verification; every network socket is blocked. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import assert from 'node:assert/strict';
const remote=process.argv[2],prefix='/staking-arena-blaze-site/',root=resolve('.pages-production');
const server=remote?undefined:createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(prefix)){res.writeHead(404).end();return;}
 const file=resolve(root,path.slice(prefix.length)||'index.html');if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
if(server)await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=remote??`http://127.0.0.1:${server.address().port}${prefix}`,browser=await chromium.launch(launchOptions),results=[];
try{
 for(const network of ['mainnet','chipnet']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>localStorage.setItem('stake-arena-welcome-dismissed','1'));
  await context.routeWebSocket(/^wss?:\/\//,s=>s.close());
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  await context.route(/^https:\/\/bcmr(?:-chipnet)?\.paytaca\.com\/api\/tokens\//,r=>r.fulfill({
   json:{token:{category:r.request().url().split('/').at(-2),symbol:'TEST',decimals:6}},headers:{'Access-Control-Allow-Origin':'*'},
  }));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?network='+network+'#/v3');
  const field=page.getByLabel('Reward per release (min. 0.00001200 BCH)',{exact:true});await field.waitFor();
  await field.fill('0.00001199');await page.getByRole('alert',{name:'cap error',exact:true}).waitFor();
  assert.match(await page.getByRole('alert',{name:'cap error',exact:true}).innerText(),/1,200 satoshis/);
  await field.fill('0.00001200');await page.getByRole('alert',{name:'cap error',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('alert',{name:'cap error',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);await page.getByText('Connect a compatible Cashonize wallet to continue.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Release interval (minutes)',{exact:true}).inputValue(),network==='mainnet'?'10':'1');
  await page.getByLabel('Reward asset',{exact:true}).selectOption('token');await page.getByLabel('Reward token category',{exact:true}).fill('ab'.repeat(32));
  const token=page.getByLabel('Reward per release (min. 1 TEST)',{exact:true});await token.fill('0.1');await page.getByRole('alert',{name:'cap error',exact:true}).waitFor();await token.fill('1');await page.getByRole('alert',{name:'cap error',exact:true}).waitFor({state:'detached'});
  await page.getByText('10 TEST',{exact:true}).waitFor();
  assert.equal(await page.getByRole('alert',{name:'cap error',exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  // A synthetic dialog event exercises compiled recovery UI without a wallet.
  const openRecovery=()=>page.evaluate(()=>{window.__recoveryDecision=undefined;window.dispatchEvent(new CustomEvent('arena-preparation-confirm',{detail:{quote:{transactions:1,approvals:1,preparationFees:[],creationFee:'0',totalFee:'185',walletDebit:'185',reserve:'0',rewardCategory:'0'.repeat(64),recovery:{operationId:'synthetic-old-request',transactionId:'aa'.repeat(32),reservedBch:'866201',returnedBch:'864816'}},respond:value=>{window.__recoveryDecision=value;}}}));});
  await openRecovery();await page.getByRole('heading',{name:'Resolve old signed request',exact:true}).waitFor();await page.getByText(/does not create your new vault/).waitFor();
  assert.equal(await page.getByText('185 satoshis',{exact:true}).isVisible(),true);
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.getByRole('button',{name:'Resolve with 1 wallet approval',exact:true}).click();assert.equal(await page.evaluate(()=>window.__recoveryDecision),true);await page.evaluate(()=>window.dispatchEvent(new Event('arena-preparation-close')));
  await openRecovery();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.__recoveryDecision),false);await page.evaluate(()=>window.dispatchEvent(new Event('arena-preparation-close')));
  assert.deepEqual(errors,[]);
  results.push({network,minimumBch:true,correctedErrorRemoved:true,wholeTokenInputs:true,unavailableWalletReason:true,mobile:true,syntheticRecoveryDialog:true,recoveryIsSeparateFromNewVault:true,recoveryFeeDisclosed:true,recoveryConsentAndCancel:true,javascriptErrors:errors});await context.close();
 }
 console.log(JSON.stringify({at:new Date().toISOString(),base,noWallet:true,publicSocketsBlocked:true,results},null,2));
}finally{await browser.close();if(server)await new Promise(done=>server.close(done));}
