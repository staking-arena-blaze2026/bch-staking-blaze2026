// Screenshots use only actual read-only local indexer data.
import { chromium } from 'playwright-core';
import { recordEvidence, finishEvidence } from './browser-evidence.mjs';
import { launchOptions } from './browser-options.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=process.env.ARENA_TEST_API?(await import('./static-server.mjs')).server:undefined;
const base=(process.env.FRONTEND_URL??'http://127.0.0.1:5173').replace(/\/$/,'');
const api=process.env.ARENA_READ_API??base+'/api';
const errors=[],requests=[];
let browser, page, failed = false;
try {
 const response=await fetch(`${api}/vaults`,{signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.chain,'regtest');assert.equal(data.confirmedOnly,true);
 await mkdir('test-results',{recursive:true});
 browser=await chromium.launch(launchOptions);
 page=await browser.newPage({viewport:{width:1440,height:1000}});await recordEvidence(page.context());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
 await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Stake Arena'}).waitFor();
 if(data.vaults.length)await page.locator('.vault-row').first().waitFor();else await page.getByText('No vaults listed',{exact:true}).waitFor();
 if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-home-live.png',fullPage:true});
 if(data.vaults.length){await page.locator('.vault-row').first().focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:/Vault /,level:1}).waitFor();await page.getByText('Maximum reward per period',{exact:true}).waitFor();if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-detail-live.png',fullPage:true});await page.getByRole('link',{name:'Make an Offer'}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Make an Offer'}).waitFor();assert.equal(await page.getByRole('button',{name:'Offer submission unavailable'}).isEnabled(),false);await page.setViewportSize({width:390,height:844});if(process.env.ARENA_CAPTURE_SCREENSHOTS==='1'&&!process.env.ARENA_SKIP_SCREENSHOTS)await page.screenshot({path:'test-results/marketplace-offer-live-mobile.png',fullPage:true});}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));
 await writeFile('test-results/marketplace-live-check.json',JSON.stringify({source:'Actual local indexer; no fixtures',tip:data.tip,vaultCount:data.vaults.length,errors,requests},null,2));
 console.log('PASS: actual indexer marketplace, vault details, offer preview, mobile layout; no JavaScript errors; GET only. Vaults: '+data.vaults.length);
} catch(error) { failed=true;console.error('Live browser diagnostics:',errors,page?await page.locator('body').innerText().catch(()=>''):'No page');throw error;} finally {await finishEvidence(page,failed);await browser?.close();if(server)await new Promise(done=>server.close(done));}
