import {chromium} from '@playwright/test';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('../.verification-artifacts/deployment-migration'),base='https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/';
const config={version:3,genesis:'fa5bae8625e61ec15a9d1527157f1e544d6d4bee9a1a268095099320e33e8c86',stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1794738991,periodSeconds:360,periods:9,cap:'1000'};
await mkdir(root,{recursive:true});
const release=await fetch(base+'release.json?migration='+Date.now()).then(r=>r.json());
const context=await chromium.launchPersistentContext(root+'/profile',{headless:true,args:['--no-sandbox','--disable-gpu']});
try{const page=context.pages()[0]??await context.newPage();await page.goto(base+'#/v3/offers',{waitUntil:'domcontentloaded'});
 if(process.argv[2]==='prepare'){
  // Deliberately seeded public configuration, never a real wallet or cached financial state.
  await page.evaluate(config=>localStorage.setItem('staking-arena-v3-configs-chipnet',JSON.stringify([config])),config);
  await writeFile(root+'/before.json',JSON.stringify({at:new Date().toISOString(),sourceCommit:release.sourceCommit,publicConfigurationOnly:true}));
 }else{
  if(process.argv[3])assert.equal(release.sourceCommit,process.argv[3]);
  const before=JSON.parse(await readFile(root+'/before.json','utf8'));assert.notEqual(before.sourceCommit,release.sourceCommit);
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('staking-arena-v3-configs-chipnet')??'[]').some(c=>c.genesis===id),config.genesis),true);
  await page.locator(`a[href="#/v3/vault/${config.genesis}"]`).waitFor({timeout:90000});
  await writeFile('../docs/blaze2026/production-deployment-migration.json',JSON.stringify({at:new Date().toISOString(),before,afterSourceCommit:release.sourceCommit,retainedPublicConfiguration:true,walletConnected:false,realUserWallet:false},null,2)+'\n');
 }
}finally{await context.close();}
