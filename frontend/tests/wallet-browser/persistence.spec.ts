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
  await page.getByRole('link',{name:'Make an Offer',exact:true}).click();
  await page.getByRole('link',{name:'Create a Vault',exact:true}).click();
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

test('offline startup is bounded; saved retry and later availability recover without QR',async({page})=>{
  await firstPair(page);
  await page.evaluate(()=>localStorage.removeItem('test-wallet-online'));
  await page.clock.install();
  await page.reload();
  await expect(page.getByText('Restoring Cashonize connection…',{exact:true})).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('button',{name:'Retry saved connection'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(key=>!!localStorage.getItem(key),key)).toBe(true);
  await page.clock.fastForward(600_000);expect((await stats(page)).attempts).toBe(1);
  await page.getByRole('button',{name:'Retry saved connection'}).click();
  await page.evaluate(()=>(window as any).walletTransport.ready());await connected(page);
  expect((await stats(page)).pairings).toBe(0);
  // Relay loss and a fresh live handshake use the same manager/transport.
  await page.evaluate(()=>(window as any).walletTransport.interrupt());
  await expect(page.getByText('Reconnecting to Cashonize…',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).walletTransport.ready());await connected(page);
  expect((await stats(page)).attempts).toBe(1);
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
  await expect(page.getByText('Reconnecting to Cashonize…',{exact:true})).toBeVisible();
  await page.clock.runFor(30_001);
  await expect(page.getByRole('button',{name:'Retry saved connection'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pair wallet again'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(key=>!!localStorage.getItem(key),key)).toBe(true);
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await expect(page.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();
  const profile=await browser.newContext();try{const other=await profile.newPage();await other.goto('/#/v3');await expect(other.getByRole('button',{name:'Connect Wallet',exact:true})).toBeVisible();expect((await stats(other)).attempts).toBe(0);}finally{await profile.close();}
});
