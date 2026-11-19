import {test,expect,type Page} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchOptions} from '../../scripts/browser-options.mjs';
const key='staking-arena-wizardconnect-v1';
async function stats(page:Page){return page.evaluate(()=>(window as any).walletTransport.stats);}
async function connected(page:Page){await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:30_000});await expect(page.getByText('Connected to Cashonize',{exact:true})).toBeVisible();expect((await stats(page)).signatures).toBe(0);}
async function firstPair(page:Page){
  await page.goto('/#/v3');
  await page.getByRole('button',{name:'Connect Wallet',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(()=>{localStorage.setItem('test-wallet-online','yes');(window as any).walletTransport.ready();});
  await connected(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('pair once; refresh, tab reopen and navigation preserve identity and pending records',async({context,page})=>{
  await firstPair(page);
  const original=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
  // Seed a synthetic pending record in the actual v1 IndexedDB journal; no spending.
  await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('staking-arena-wallet-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('operations');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('operations','readwrite');tx.objectStore('operations').put({version:1,network:'chipnet',id:'pending',kind:'create',step:'genesis',stage:'pending',observation:'submitted',parameters:{stakingCategory:'11'.repeat(32),epoch:1800000000,periodSeconds:60,periods:2,cap:1000},coins:[],txid:'22'.repeat(32),genesis:'22'.repeat(32),pregenesis:'33'.repeat(32),updatedAt:0},'pending');tx.oncomplete=()=>{db.close();resolve();};};});});
  await page.getByRole('link',{name:'Browse All Vaults',exact:true}).click();
  await page.getByRole('link',{name:'Create Vault',exact:true}).click();
  await connected(page);expect((await stats(page)).attempts).toBe(1);
  await page.reload();await connected(page);expect((await stats(page)).pairings).toBe(0);
  await page.close();page=await context.newPage();await page.goto('/#/v3');await connected(page);
  expect((await stats(page)).restored).toEqual([original.walletPublicKey]);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).paths,key)).toEqual(original.paths);
  const record=await page.evaluate(async()=>new Promise(resolve=>{const r=indexedDB.open('staking-arena-wallet-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('operations').objectStore('operations').get('pending');q.onsuccess=()=>{resolve(q.result);db.close();};};}));
  expect(record).toEqual({version:1,network:'chipnet',id:'pending',kind:'create',step:'genesis',stage:'pending',observation:'submitted',parameters:{stakingCategory:'11'.repeat(32),epoch:1800000000,periodSeconds:60,periods:2,cap:1000},coins:[],txid:'22'.repeat(32),genesis:'22'.repeat(32),pregenesis:'33'.repeat(32),updatedAt:0});
});

test('real Chromium process restart with the same disk profile and simulated machine restart',async({playwright,baseURL})=>{
  const profile=await mkdtemp(join(tmpdir(),'arena-wallet-profile-'));
  let context=await playwright.chromium.launchPersistentContext(profile,{...launchOptions,baseURL});
  try {
    let page=await context.newPage();await firstPair(page);
    const identity=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).walletPublicKey,key);
    for(const label of ['browser process restart','simulated computer restart']){
      await context.close();
      context=await playwright.chromium.launchPersistentContext(profile,{...launchOptions,baseURL});
      page=await context.newPage();await page.goto('/#/v3');await connected(page);
      expect((await stats(page)).pairings,label).toBe(0);
      expect((await stats(page)).restored,label).toEqual([identity]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  } finally {await context.close();await rm(profile,{recursive:true,force:true});}
});

test('offline startup keeps automatically retrying and later wallet availability recovers without Retry or QR',async({page})=>{
  await firstPair(page);
  await page.evaluate(()=>localStorage.removeItem('test-wallet-online'));
  await page.clock.install();
  await page.reload();
  await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('button',{name:'Retry saved connection'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Pair wallet again'})).toBeVisible();
  await expect(page.getByText(/Open Cashonize to reconnect|Pairing is saved in this browser profile/)).toHaveCount(0);
  for(const width of [1672,1024,768,390,320]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const banner=document.querySelector('.brand-slogan')!.getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.wallet-actions button')].map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height,overlap:r.left<banner.right&&r.right>banner.left&&r.top<banner.bottom&&r.bottom>banner.top};})};
    });
    expect(layout.overflow).toBe(false);expect(layout.buttons.every(b=>!b.overlap&&b.width<160&&b.height<=34)).toBe(true);
  }

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(key=>!!localStorage.getItem(key),key)).toBe(true);
  await page.clock.runFor(600_000);expect((await stats(page)).attempts).toBeGreaterThan(1);
  expect((await stats(page)).handshakes).toBeGreaterThan(4);
  await page.evaluate(()=>localStorage.setItem('test-wallet-online','yes'));
  await page.clock.runFor(30_001);await connected(page);
  expect((await stats(page)).pairings).toBe(0);
  const restoredAttempts=(await stats(page)).attempts;
  // An immediately restored relay loss keeps this manager/transport.
  await page.evaluate(()=>(window as any).walletTransport.interrupt());
  await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).walletTransport.ready());await connected(page);
  expect((await stats(page)).attempts).toBe(restoredAttempts);
});

test('disconnect, revocation, cleared storage and a different profile require explicit pairing',async({browser,page})=>{
  await firstPair(page);
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
  await page.reload();await expect(page.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();
  expect((await stats(page)).attempts).toBe(0);
  await firstPair(page);
  await page.clock.install();
  await page.evaluate(()=>localStorage.removeItem('test-wallet-online'));
  await page.evaluate(()=>(window as any).walletTransport.revoke());
  await page.clock.runFor(8_001);
  await expect(page.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
  await page.clock.runFor(60_001);
  await page.reload();
  await expect(page.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
  expect((await stats(page)).attempts).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(key=>!!localStorage.getItem(key),key)).toBe(true);
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await expect(page.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();
  const profile=await browser.newContext();try{const other=await profile.newPage();await other.goto('/#/v3');await expect(other.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();expect((await stats(other)).attempts).toBe(0);}finally{await profile.close();}
});

async function installOfflineEstimate(page:Page){
 await page.addInitScript(()=>{
  const operations:string[]=[];
  Object.assign(window,{offlinePreviewOperations:operations});
  window.Worker=new Proxy(window.Worker,{construct(target,args){
   if(!String(args[0]).includes('queue.worker'))return Reflect.construct(target,args);
   const worker={
    onmessage:undefined as ((e:{data:unknown})=>void)|undefined,
    terminate(){},
    postMessage({id,intent}:{id:number;intent:{operation:string}}){
     operations.push(intent.operation);
     const result=intent.operation==='previewCreate'?{atomic:true,commitment:'a'.repeat(64),quote:{transactions:1,approvals:1,preparationFees:[],creationFee:'612',totalFee:'612',walletDebit:'33012',reserve:'20000',rewardCategory:'0'.repeat(64)}}:intent.operation==='discover'?{vaults:[]}:[];
     queueMicrotask(()=>worker.onmessage?.({data:{id,result}}));
    },
   };
   queueMicrotask(()=>worker.onmessage?.({data:{type:'ready'}}));
   return worker;
  }});
 });
}

test('offline creation estimates survive a Chromium process restart using the saved public paths',async({playwright,baseURL})=>{
 const profile=await mkdtemp(join(tmpdir(),'arena-offline-preview-'));
 let context=await playwright.chromium.launchPersistentContext(profile,{...launchOptions,baseURL});
 try{
  let page=await context.newPage();await installOfflineEstimate(page);await firstPair(page);
  await expect(page.locator('.wallet-control small[title]')).toContainText('Address:');
  await page.evaluate(()=>localStorage.removeItem('test-wallet-online'));
  await context.close();
  context=await playwright.chromium.launchPersistentContext(profile,{...launchOptions,baseURL});
  page=await context.newPage();await installOfflineEstimate(page);await page.goto('/#/v3');
  await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:45_000});
 await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Create Vault',exact:true}).click();
  const estimate=page.getByRole('dialog',{name:'Review vault creation estimate'});
  await expect(estimate).toBeVisible();expect((await stats(page)).signatures).toBe(0);
  await estimate.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(estimate).toHaveCount(0);
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('paired offline creation reviews cost before restoration, preserves inputs and clears intent on reload',async({page})=>{
 await installOfflineEstimate(page);
 await firstPair(page);
 await expect(page.locator('.wallet-control small[title]')).toContainText('Address:');
 await page.evaluate(()=>localStorage.removeItem('test-wallet-online'));await page.reload();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:45_000});
 await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
 await page.clock.install();
 await expect(page.locator('.wallet-control small[title]')).toContainText('Last connected address:');
 await page.getByLabel('Release interval (minutes)',{exact:true}).fill('120');
 const button=page.getByRole('button',{name:'Create Vault',exact:true});await expect(button).toBeEnabled();await button.click();
 const dialog=page.getByRole('dialog',{name:'Review vault creation estimate'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByText('612 satoshis',{exact:true})).toHaveCount(2);
 await page.clock.fastForward(120_101);
 await expect(dialog).toBeVisible();await expect(page.getByText(/Wallet connection timed out/)).toHaveCount(0);
 const operations=await page.evaluate(()=>Object.assign(window).offlinePreviewOperations as string[]);
 expect(operations).toContain('previewCreate');expect(operations).not.toContain('prepare');expect((await stats(page)).signatures).toBe(0);
 await dialog.getByRole('button',{name:'Accept estimate and reconnect'}).click();
 await expect(page.getByText(/Reopen Cashonize to continue/)).toBeVisible();
 await page.clock.fastForward(90_101);await expect(page.getByText(/Wallet connection timed out/)).toBeVisible();
 await expect(page.getByLabel('Release interval (minutes)',{exact:true})).toHaveValue('120');
 expect((await stats(page)).signatures).toBe(0);
 await button.click();await expect(dialog).toBeVisible();
 await page.reload();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:45_000});
 await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
 await expect(dialog).toHaveCount(0);expect((await stats(page)).signatures).toBe(0);
});

test('an offline pairing with altered public paths asks for a fresh authenticated connection',async({page})=>{
 await installOfflineEstimate(page);
 await firstPair(page);
 await page.evaluate(key=>{
  localStorage.removeItem('test-wallet-online');const session=JSON.parse(localStorage.getItem(key)!);
  session.paths.push({...session.paths[0],name:'change'});localStorage.setItem(key,JSON.stringify(session));
 },key);
 await page.reload();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible({timeout:45_000});
 await expect(page.getByText('Cashonize paired · Wallet offline',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Create Vault',exact:true}).click();
 await expect(page.getByText(/Open Cashonize and connect once/)).toBeVisible();
 expect(await page.evaluate(()=>Object.assign(window).offlinePreviewOperations)).not.toContain('previewCreate');
 expect((await stats(page)).signatures).toBe(0);
});
