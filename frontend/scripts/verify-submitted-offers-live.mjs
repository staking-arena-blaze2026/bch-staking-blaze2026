// Read-only verification in a fresh browser; never uses a wallet or broadcasts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {launchOptions} from './browser-options.mjs';
const base='https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const expected=process.argv[2];
assert.match(expected??'',/^[a-f0-9]{40}$/);
const release=await (await fetch(base+'release.json?verify='+Date.now())).json();
assert.equal(release.sourceCommit,expected);
assert.equal(release.sourceRepository,'https://github.com/staking-arena-blaze2026/bch-staking-blaze2026');
const arenaAsset=release.assets.find(a=>/^assets\/V3Arena-.*\.js$/.test(a.path));assert.ok(arenaAsset);
const arenaSource=await (await fetch(base+arenaAsset.path)).text();
assert.equal(createHash('sha256').update(arenaSource).digest('hex'),arenaAsset.sha256);
assert.ok(arenaSource.includes('awaiting on-chain verification'));assert.ok(arenaSource.includes('accepted-to-provisional-row'));
const browser=await chromium.launch(launchOptions),page=await browser.newPage();
const errors=[],failedAssets=[],broadcasts=[];
try{
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&/\.(?:js|css)(?:\?|$)/.test(r.url()))failedAssets.push({url:r.url(),status:r.status()});});
 await page.addInitScript(()=>{
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker {
   constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data?.type==='timing'&&event.data.timing?.requests?.['blockchain.transaction.broadcast'])window.dispatchEvent(new Event('unexpected-broadcast'));});}
  };
 });
 await page.exposeFunction('reportUnexpectedBroadcast',()=>broadcasts.push('broadcast timing observed'));
 await page.addInitScript(()=>window.addEventListener('unexpected-broadcast',()=>window.reportUnexpectedBroadcast()));
 await page.goto(base+'#/v3/offers');
 await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor({timeout:60000});
 const card=page.locator('.v3-vault-card').first();await card.waitFor({timeout:60000});const href=await card.getAttribute('href');await card.click();
 await page.locator('.v3-summary').waitFor({timeout:120000});
 assert.doesNotMatch(await page.locator('.v3-queue').innerText(),/Current state transaction:/);
 assert.equal(await page.getByRole('button',{name:'Make an Offer',exact:true}).isDisabled(),true);
 await page.reload();await page.locator('.v3-summary').waitFor({timeout:120000});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await mkdir('../docs/blaze2026/submitted-offers',{recursive:true});
 await page.screenshot({path:'../docs/blaze2026/submitted-offers/deployed-mobile.png',fullPage:true});
 const result={verifiedAt:new Date().toISOString(),sourceCommit:release.sourceCommit,verifiedArenaAsset:arenaAsset.path,url:base,selectedVault:href,pageErrors:errors,failedAssets,broadcasts,walletConnected:false,bchSpent:0,scope:'Live read-only navigation, verified queue, reload, mobile; synthetic offer lifecycle is covered by loopback browser tests'};
 assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);assert.deepEqual(broadcasts,[]);
 await writeFile('../docs/blaze2026/submitted-offers/deployed-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
