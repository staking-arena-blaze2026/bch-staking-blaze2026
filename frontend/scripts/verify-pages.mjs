// Verify the actual project prefix in a browser, locally or on GitHub Pages.
import { chromium } from 'playwright-core';
import { recordEvidence, finishEvidence } from './browser-evidence.mjs';
import { launchOptions } from './browser-options.mjs';
import { createServer } from 'node:http';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve,extname,dirname } from 'node:path';
import assert from 'node:assert/strict';
const target=process.argv[2]??'https://scinklja.github.io/staking-arena-site/';
const base=new URL(target),prefix=base.pathname;
assert.equal(prefix,'/staking-arena-site/');
let server,browser,page,testFailed=false;
if(process.argv[3]) {
 const root=resolve(process.argv[3]);
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,base).pathname;
  if(!path.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=resolve(root,decodeURIComponent(path.slice(prefix.length))||'index.html');
  if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404).end();}
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(Number(base.port),'127.0.0.1',done);});
}
const errors=[],failed=[],requests=[];
try {
 browser=await chromium.launch(launchOptions);
 page=await browser.newPage({viewport:{width:1280,height:900}});
 await recordEvidence(page.context());
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 const go=hash=>page.goto(target+hash,{waitUntil:'domcontentloaded'});
 const waitHeading=name=>page.getByRole('heading',{name,level:1,exact:true}).waitFor();
 const response=await go('');assert.equal(response.status(),200);
 await waitHeading('Stake Arena');
 await page.getByText('Offline · no API configured',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Create Vault',exact:true}).getAttribute('href'),'#/create');
 await page.waitForFunction(()=>getComputedStyle(document.body).margin==='0px');
 assert.match(await page.title(),/Vault marketplace/);
 console.log('PASS: marketplace HTML, JavaScript and CSS load below '+prefix);
 await go('#/create');await waitHeading('Create Vault');
 await page.reload({waitUntil:'domcontentloaded'});await waitHeading('Create Vault');
 assert.equal(await page.getByRole('button',{name:'Review funding in wallet'}).isDisabled(),true);
 console.log('PASS: direct creation route and reload retain the GitHub Pages prefix');
 const hash='#/vault/'+'0'.repeat(64);
 await go(hash);await page.getByRole('heading',{name:'Vault data unavailable',exact:true}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Vault data unavailable',exact:true}).waitFor();
 assert.equal(new URL(page.url()).hash,hash);
 await page.setViewportSize({width:390,height:844});await go('#/create');await waitHeading('Create Vault');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 assert.ok(requests.every(r=>r.url.startsWith('data:')||(r.method==='GET'&&new URL(r.url).origin===base.origin&&new URL(r.url).pathname.startsWith(prefix))));
 assert.ok(!requests.some(r=>r.url.includes('/api/')||r.url.includes('/vaults')));
 const report={url:target,prefix,httpStatus:response.status(),marketplace:true,creationPreview:true,directVaultRoute:true,reload:true,mobile:true,offline:true,noBackendRequests:true,javascriptErrors:errors,failedResponses:failed,requests:requests.length};
 const reportPath=process.env.PAGES_REPORT??'test-results/github-pages-check.json';await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} catch(error) {testFailed=true;throw error;} finally {await finishEvidence(page,testFailed);if(browser)await browser.close();if(server)await new Promise(done=>server.close(done));}
