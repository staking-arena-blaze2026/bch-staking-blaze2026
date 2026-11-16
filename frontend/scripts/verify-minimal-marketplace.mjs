// Fresh-profile, read-only production acceptance. Never connects a wallet.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchOptions} from './browser-options.mjs';
const base=process.env.ARENA_VERIFY_URL??'https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const output=process.env.ARENA_VERIFY_OUTPUT??'/tmp/blaze-minimal-marketplace';
await mkdir(output,{recursive:true});
const browser=await chromium.launch(launchOptions);
const context=await browser.newContext();
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const report={url:base,checkedAt:new Date().toISOString(),errors};
try{
 const manifest=await context.request.get(base+'release.json',{headers:{'Cache-Control':'no-cache'}});assert.equal(manifest.status(),200);report.release=await manifest.json();
 if(process.env.ARENA_EXPECT_SOURCE)assert.equal(report.release.sourceCommit,process.env.ARENA_EXPECT_SOURCE);
 for(let i=0;i<report.release.assets.length;i+=4)await Promise.all(report.release.assets.slice(i,i+4).map(async asset=>{const response=await context.request.get(base+asset.path);assert.equal(response.status(),200);assert.equal(createHash('sha256').update(await response.body()).digest('hex'),asset.sha256,asset.path);}));
 report.assetsVerified=report.release.assets.length;
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor({timeout:90000});
 await page.locator('.v3-tabs').waitFor({timeout:90000});
 assert.equal(new URL(page.url()).hash,'#/v3/offers');
 assert.equal(await page.locator('.v3-tabs a').first().innerText(),'Make an Offer');
 assert.equal(await page.locator('.v3-tabs a').first().getAttribute('aria-current'),'page');
 assert.equal(await page.locator('.brand').getAttribute('href'),'#/v3/offers');
 assert.equal(await page.locator('.wallet-network-note').count(),0);
 assert.equal(await page.getByText(/Mainnet uses real BCH\. Review exact amounts/).count(),0);
 assert.equal(await page.getByRole('heading',{name:'Known vaults',exact:true}).evaluate(el=>el.nextElementSibling?.textContent),'Refresh public discovery');
 assert.deepEqual(await page.getByRole('columnheader').allTextContents(),['Vault','Max reward / period','Staking asset','Offers']);
 await page.locator('.marketplace-table tbody tr').first().waitFor({timeout:90000});
 await page.waitForFunction(()=>[...document.querySelectorAll('.marketplace-table tbody tr td:last-child')].some(el=>el.textContent!=='Verifying…'),{},{timeout:120000});
 report.rows=await page.locator('.marketplace-table tbody tr').evaluateAll(rows=>rows.map(row=>({cells:[...row.querySelectorAll('td')].map(c=>c.textContent),href:row.querySelector('a')?.getAttribute('href')})));
 for(const [i,row]of report.rows.entries()){assert.equal(row.cells[0],String(i+1));assert.equal(row.cells.length,4);assert.match(row.href,/^#\/v3\/vault\/[a-f0-9]{64}$/);}
 for(const width of [1360,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${output}/marketplace-${width}.png`,fullPage:true});}
 // Click the Offers cell to check the full-row hit area, then use the logo to return.
 const href=await page.locator('.marketplace-table tbody a').first().getAttribute('href');
 await page.locator('.marketplace-table tbody tr td:last-child').first().click();await page.waitForURL(u=>u.hash===href);report.detailRoute=new URL(page.url()).hash;
 await page.locator('.brand').click();await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 const link=page.locator('.marketplace-table tbody a').first();await link.focus();await page.keyboard.press('Enter');await page.waitForURL(u=>u.hash===href);
 await page.getByRole('link',{name:'Create a Vault',exact:true}).click();await page.getByRole('heading',{name:'Create a v3 vault'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isEnabled(),false);
 await page.getByRole('combobox',{name:'Network',exact:true}).selectOption('chipnet');await page.waitForURL(/network=chipnet/);await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor({timeout:90000});report.networkSwitch=true;
 assert.deepEqual(errors,[]);report.passed=true;
}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report,null,2));
