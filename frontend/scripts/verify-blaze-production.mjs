import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const base='https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const expected=process.argv[2];
const release=await fetch(base+'release.json?check='+Date.now()).then(r=>{assert.equal(r.status,200);return r.json();});
if(expected)assert.equal(release.sourceCommit,expected);
const catalog=await fetch(base+'v3-vaults.json?check='+Date.now()).then(r=>{assert.equal(r.status,200);return r.json();});
const genesis='fa5bae8625e61ec15a9d1527157f1e544d6d4bee9a1a268095099320e33e8c86';
assert.ok(catalog.vaults.some(c=>c.genesis===genesis));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
try{
 const profiles=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext();const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'#/v3/offers',{waitUntil:'domcontentloaded',timeout:60000});
  const card=page.locator(`a[href="#/v3/vault/${genesis}"]`);await card.waitFor({timeout:90000});
  // The real public index must respond, including when its history is empty.
  await page.getByText(/Public on-chain discovery: \d+ announcements observed/).waitFor({timeout:120000});
  await page.waitForFunction(id=>document.querySelector(`a[href="#/v3/vault/${id}"]`)?.textContent?.match(/Verification temporarily unavailable|Confirmed · chain verified/),genesis,{timeout:120000});
  const listing=await card.innerText(),discovery=await page.getByText(/Public on-chain discovery: \d+ announcements observed/).innerText();
  await card.click();await page.getByRole('heading',{name:/Vault [a-f0-9]{16}/}).waitFor();
  await page.screenshot({path:`../docs/blaze2026/production-vault-${i+1}.png`,fullPage:true});
  profiles.push({freshProfile:true,walletConnected:false,listing,discovery,pageErrors:errors});assert.deepEqual(errors,[]);await context.close();
 }
 const result={at:new Date().toISOString(),productionUrl:base,sourceCommit:release.sourceCommit,catalog,profiles,liveWalletSigning:false,newLiveAnnouncedVaultVerified:false};
 await writeFile('../docs/blaze2026/production-discovery-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
