// Read-only release check. Uses a new synthetic browser profile and blocks WSS;
// it neither connects to a wallet nor submits any transaction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {launchOptions} from './browser-options.mjs';
const [expected,output]=process.argv.slice(2);
assert.match(expected??'',/^[a-f0-9]{40}$/,'Pass the exact expected source commit');
const base='https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const response=await fetch(base+'release.json?verify='+Date.now(),{signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);const release=await response.json();
assert.equal(release.sourceCommit,expected);assert.equal(release.sourceBranch,'blaze2026');
assert.equal(release.sourceRepository,'https://github.com/staking-arena-blaze2026/bch-staking-blaze2026');
assert.equal(release.websiteRepository,'https://github.com/staking-arena-blaze2026/staking-arena-blaze-site');
assert.ok(Array.isArray(release.assets)&&release.assets.length>0);
const checked=[];
for(let start=0;start<release.assets.length;start+=4){
 const settled=await Promise.allSettled(release.assets.slice(start,start+4).map(async asset=>{
  assert.ok(/^(assets\/|public-index\/|index\.html$|arena\.svg$|v3-vaults(?:-mainnet)?\.json$)/.test(asset.path)&&!asset.path.split('/').includes('..'));
  const data=await fetch(base+asset.path+'?source='+expected,{signal:AbortSignal.timeout(30000)});assert.equal(data.status,200,asset.path);
  const bytes=Buffer.from(await data.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,asset.sha256,asset.path);assert.equal(bytes.length,asset.bytes,asset.path);
  return {path:asset.path,sha256:hash,bytes:bytes.length};
 }));
 for(const row of settled){if(row.status==='rejected')throw row.reason;checked.push(row.value);}
}
const browser=await chromium.launch(launchOptions),networks=[];
try{
 for(const network of ['mainnet','chipnet']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  await context.routeWebSocket(/^wss:\/\//,socket=>socket.onMessage(()=>{}));
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'?network='+network+'&source='+expected+'#/v3',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Release interval (minutes)',{exact:true}).waitFor({state:'visible',timeout:60000});
  const button=page.getByRole('button',{name:'Create Vault',exact:true});
  assert.equal(await button.isDisabled(),true,'Unpaired '+network+' must require a wallet');
  assert.equal(await page.getByRole('button',{name:'Connect Wallet',exact:true}).isVisible(),true);
  assert.deepEqual(errors,[]);networks.push({network,creationForm:true,unpairedSigningBlocked:true,errors});await context.close();
 }
}finally{await browser.close();}
const result={at:new Date().toISOString(),sourceCommit:expected,sourceRevisionVerified:true,assetHashesVerified:checked.length,assets:checked,networks,scope:'Read-only published assets and disconnected UI. WSS blocked, fresh synthetic browser profiles; no physical Cashonize, public-provider signing or transaction broadcast.'};
if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:expected,assets:checked.length,networks}));
