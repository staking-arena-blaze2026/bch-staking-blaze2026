import { expect,test } from '@playwright/test';
import { browserFixture as fixture, browserTime } from '../fixture';
const id='a'.repeat(64);
test.beforeEach(async({page})=>{await page.clock.setFixedTime(browserTime);});
test('production offline build renders marketplace and creation preview with no backend',async({page})=>{
 const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto('/#/v1',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Stake Arena'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('No API is configured');
 await page.getByRole('link',{name:'Create Vault'}).click();await expect(page.getByRole('heading',{name:'Create Vault',exact:true})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 expect(requests.every(url=>new URL(url).origin==='http://127.0.0.1:4174'&&!url.includes('/api/'))).toBe(true);expect(errors).toEqual([]);
});
test('configured production hash routes, offer preview and persistent outage labels work',async({page})=>{
 let online=true;await page.route('https://indexer.example.test/read-only/vaults',route=>online?route.fulfill({json:fixture(),headers:{'Access-Control-Allow-Origin':'*'}}):route.abort());
 await page.goto('/configured/#/vault/'+id,{waitUntil:'domcontentloaded'});await expect(page.getByText('Current period',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Make an Offer'})).toBeEnabled();
 online=false;await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('alert')).toContainText('Saved indexed snapshot');
 const offerLink=page.getByRole('link',{name:'Make an Offer'});
 await expect(offerLink).toBeDisabled();await expect(offerLink).toHaveAttribute('aria-disabled','true');await expect(offerLink).not.toHaveAttribute('href');
 // Preview deep links remain readable while stale data blocks submission.
 await page.goto('/configured/#/vault/'+id+'/offer',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('not current');
 for(const [label,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const)await page.getByRole('textbox',{name:label}).fill(value);
 await expect(page.getByText('9,000 raw token units',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Make an Offer',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Refresh data',exact:true})).toBeEnabled();
 online=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
