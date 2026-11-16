// Production static smoke checks, using one browser to fit the development VM.
import { chromium } from 'playwright-core';
import { recordEvidence, finishEvidence } from './browser-evidence.mjs';
import { launchOptions } from './browser-options.mjs';
import { browserFixture as fixture, browserTime } from '../tests/fixture.ts';
import assert from 'node:assert/strict';
const { server }=await import('./static-server.mjs');
let browser, page, failed = false;
try {
 browser=await chromium.launch(launchOptions);
 page=await browser.newPage({viewport:{width:1280,height:900}});await recordEvidence(page.context());await page.clock.install({time:browserTime});await page.clock.setFixedTime(browserTime);
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 const go=path=>page.goto('http://127.0.0.1:4174'+path,{waitUntil:'domcontentloaded'});
 await go('/#/v1');await page.getByRole('heading',{name:'Stake Arena'}).waitFor();await page.getByText('Offline · no API configured',{exact:true}).waitFor();
 assert.equal(requests.filter(r=>r.url.includes('/api/')).length,0);
 await page.getByRole('link',{name:'Create Vault'}).click();await page.getByRole('heading',{name:'Create Vault'}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Create Vault',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Review funding in wallet'}).isEnabled(),false);
 assert.equal(await page.getByRole('option').count(),8);
 console.log('PASS: production offline marketplace, direct creation route and preview-only controls');
 const id='a'.repeat(64);let online=true;
 await page.route('https://indexer.example.test/read-only/vaults',route=>online?route.fulfill({json:fixture(),headers:{'Access-Control-Allow-Origin':'*'}}):route.abort());
 await go('/configured/#/vault/'+id);await page.getByText('Maximum reward per period',{exact:true}).waitFor();
 const rows=page.getByRole('table',{name:'Competing offers ranked by priority'}).getByRole('row');assert.match(await rows.nth(1).textContent(),/Offer #01/);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Maximum reward per period',{exact:true}).waitFor();
 if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-vault-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Make an Offer'}).click();await page.getByRole('heading',{name:'Make an Offer'}).waitFor();
 for(const [name,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']])await page.getByRole('textbox',{name}).fill(value);
 await page.getByText('9,000 raw token units',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Make an Offer'}).isEnabled(),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-offer-mobile.png',fullPage:true});
 online=false;await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Last-known indexed snapshot · not current',{exact:true}).waitFor();
 // Observe an actual scheduled refresh rather than assuming it completed after 11 seconds.
 await page.getByRole('button',{name:'Refresh data',exact:true}).waitFor();
 const failedPoll=page.waitForEvent('requestfailed',r=>r.url()==='https://indexer.example.test/read-only/vaults');
 await page.clock.fastForward(10000);await failedPoll;
 await page.getByRole('button',{name:'Refresh data',exact:true}).waitFor();
 await page.getByText('Last-known indexed snapshot · not current',{exact:true}).waitFor();
 await page.clock.resume();
 await go('/configured/#/vault/'+id);await page.getByText('Period at snapshot',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Refresh data',exact:true}).waitFor();
 online=true;await page.getByRole('button',{name:'Refresh data'}).click();await page.getByText('Current period',{exact:true}).waitFor();await page.getByRole('alert').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
 console.log('PASS: production direct vault/offer routes, ranking, calculation, mobile layout, snapshot persistence and recovery; no JavaScript errors; GET only');
 if(process.env.ARENA_LIVE_URL){
  const base=process.env.ARENA_LIVE_URL;const response=await fetch(base+'/api/vaults',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const data=await response.json();assert.equal(data.chain,'regtest');assert.equal(data.confirmedOnly,true);
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/#/v1',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Stake Arena'}).waitFor();
  if(data.vaults.length){await page.locator('.vault-row').first().waitFor();if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-home-live.png',fullPage:true});const v=data.vaults[0];await page.goto(base+'/#/vault/'+v.category,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:/Vault /}).waitFor();await page.getByText('Maximum reward per period',{exact:true}).waitFor();}
  else await page.getByText('No vaults listed',{exact:true}).waitFor();
  if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-live-indexer.png',fullPage:true});
  console.log('PASS: actual local indexer data (no fixtures), vaults='+data.vaults.length);
 }
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));console.log('PASS: no browser JavaScript errors; all network requests are GET');
} catch(error) { failed=true; if(page) console.error('Browser failure:',page.url(),await page.locator('body').innerText().catch(()=>''));throw error; } finally {await finishEvidence(page,failed);await browser?.close();await new Promise(done=>server.close(done));}
