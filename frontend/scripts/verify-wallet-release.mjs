/** Read-only Blaze release verification in a fresh browser profile. No wallet signs. */
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const expected=process.argv[2];
assert.match(expected??'',/^[a-f0-9]{40}$/);
const response=await fetch(base+'release.json?verification='+Date.now());
assert.equal(response.status,200);
const release=await response.json();
assert.equal(release.sourceCommit,expected);
assert.equal(release.defaultNetwork,'mainnet');
assert.equal(release.chipnetTransactionsEnabled,false);
let assetsVerified=0;
for(const asset of release.assets){
 const url=new URL(asset.path,base);assert.ok(url.href.startsWith(base));
 const file=await fetch(url);assert.equal(file.status,200);
 const bytes=Buffer.from(await file.arrayBuffer());
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
 assetsVerified++;
}
const browser=await chromium.launch(launchOptions);
const report={verifiedAt:new Date().toISOString(),url:base,sourceCommit:expected,assetsVerified,realWalletHandshake:false,spendingRequested:false};
try {
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(30_000);
 page.on('pageerror',error=>errors.push(error.name));
 // This verification must never send wallet requests or blockchain broadcasts.
 await context.routeWebSocket(/^wss?:\/\//,socket=>socket.onMessage(()=>{}));
 await context.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){if(this.readyState>=WebSocket.CLOSING)return;send.call(this,data);};});
 await page.goto(base+'#/v3');
 await page.getByRole('button',{name:'Connect Wallet',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);
 await page.getByRole('link',{name:'Browse All Vaults',exact:true}).click();
 await page.getByRole('heading',{name:'Known vaults',exact:true}).waitFor();
 await page.getByRole('link',{name:'Create Vault',exact:true}).click();
 await page.getByRole('button',{name:'Connect Wallet',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Connect Wallet',exact:true}).waitFor();
 report.navigation=true;report.firstPairingDialog=true;
 const key='staking-arena-wizardconnect-v1-mainnet';
 // Synthetic transport-only record: exercises compiled restoration/offline UI.
 // It is not a real wallet session or a proof of real Cashonize reconnection.
 await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({privateKey:'01'.repeat(32),secret:'a1'.repeat(8),walletPublicKey:'79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'})),key);
 await page.clock.install();
 await page.reload();
 await page.getByText('Restoring Cashonize connection…',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.getByRole('button',{name:'Create Vault',exact:true}).isDisabled(),true);
 await page.clock.fastForward(30_001);
 await page.getByRole('button',{name:'Retry saved connection',exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.evaluate(key=>!!localStorage.getItem(key),key),true);
 report.savedRestorationWithoutQr=true;report.offlineDeadline=true;report.savedPairingPreserved=true;report.signingDisabled=true;
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();
 await page.getByRole('button',{name:'Connect Wallet',exact:true}).waitFor();
 assert.equal(await page.evaluate(key=>localStorage.getItem(key)===null,key),true);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 report.mobile=true;report.javascriptErrors=errors;
 console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
