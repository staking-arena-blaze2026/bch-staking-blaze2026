// Execute only a local compiled release. Public Electrum sockets are intercepted.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {launchOptions} from './browser-options.mjs';
import assert from 'node:assert/strict';
const root=resolve('.pages-production'),prefix='/staking-arena-site/';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(!path.startsWith(prefix)){res.writeHead(404).end();return;}
 const file=resolve(root,path.slice(prefix.length)||'index.html');
 if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}${prefix}`,browser=await chromium.launch(launchOptions);
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await context.routeWebSocket(/^wss?:\/\//,socket=>socket.close());
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 await context.route('https://bcmr-chipnet.paytaca.com/api/tokens/**',route=>route.fulfill({
  json:{token:{category:route.request().url().split('/').at(-2),symbol:'TEST',decimals:2}},headers:{'Access-Control-Allow-Origin':'*'},
 }));
 await context.addInitScript(()=>{
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...rest){
   const endpoints=['wss://127.0.0.1:1','wss://localhost:1'];
   if(message?.type==='start')message={...message,config:{...message.config,endpoints}};
   if(message?.method==='start')message={...message,args:[{...message.args[0],endpoints},...message.args.slice(1)]};
   return post.call(this,message,...rest);
  };
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(base+'#/create');await page.getByRole('heading',{name:'Create Vault',exact:true}).waitFor();
 const staking=page.getByRole('combobox',{name:'Staking asset',exact:true}),reward=page.getByRole('combobox',{name:'Reward asset',exact:true});
 for(const field of [staking,reward]){assert.equal(await field.isEnabled(),true);assert.ok((await field.boundingBox()).height>=44);}
 await staking.tap();await page.keyboard.press('Escape');
 await page.getByLabel('Schedule starts (UTC)').fill('2027-01-01T00:00');await page.getByLabel('Number of periods').fill('3');
 for(const stake of ['bch','token'])for(const pay of ['bch','token']){
  await staking.selectOption(stake);await reward.selectOption(pay);
  if(stake==='token')await page.getByLabel(/^Staking asset category/).fill('ab'.repeat(32));
  if(pay==='token')await page.getByLabel(/^Reward token category/).fill('cd'.repeat(32));
  await page.getByLabel(/^Maximum reward per period/).fill(pay==='bch'?'0.00002001':'7');
  const reserve=page.locator('.calculation dl>div').filter({has:page.getByText('Total upfront reward reserve',{exact:true})});
  assert.match(await reserve.innerText(),pay==='bch'?/0\.00006003 BCH/:/21 TEST/);
  assert.equal(await page.getByRole('button',{name:'Review funding in wallet',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.calculation dd').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),true,'Funding values fit without clipping');
 }
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/unified-create-token-rewards-mobile.png',fullPage:true});
 // A local hint must show the actual assets while retaining explicit verification.
 const config={version:2,genesis:'c'.repeat(64),stakingAsset:{kind:'bch'},rewardAsset:{kind:'token',category:'cd'.repeat(32)},cap:'7',periods:3,periodSeconds:60,epoch:1800000000};
 await page.evaluate(config=>localStorage.setItem('arena-local-vaults-v2',JSON.stringify([config])),config);
 await page.goto(base);const link=page.getByRole('link',{name:/V2 vault cccc/});await link.waitFor();
 await page.getByText(/Staking: BCH\. Reward: TEST/).waitFor();
 await link.click();await page.getByLabel('V2 vault configuration').waitFor();assert.match(await page.getByLabel('V2 vault configuration').inputValue(),/"cap": "7"/);
 assert.equal(await page.getByRole('button',{name:'Verify and refresh vault'}).isDisabled(),false); // public read-only client; no wallet/signature needed
 assert.deepEqual(errors,[]);
 await writeFile('test-results/unified-create-pages.json',JSON.stringify({localOnly:true,externalSocketsIntercepted:true,pairs:4,touch:true,minimumSelectHeight:44,exactBch:true,integerTokens:true,fundingValuesNotClipped:true,v2LocalDiscovery:true,javascriptErrors:errors},null,2)+'\n');
 console.log('PASS: local Pages release; all four pairs, touch targets, exact reserves, unclipped mobile values and v2 discovery; no external chain queries');
}finally{await browser.close();await new Promise(done=>server.close(done));}
