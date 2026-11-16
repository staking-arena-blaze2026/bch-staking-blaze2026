import { expect,test } from '@playwright/test';
import { browserFixture as fixture, browserTime } from '../fixture';
const id='a'.repeat(64);
test.beforeEach(async({page,context})=>{await context.routeWebSocket(/^wss:\/\/relay\./,socket=>{socket.onMessage(()=>{});});await page.clock.setFixedTime(browserTime);});
test('marketplace uses indexed terms and detail links survive reload',async({page})=>{
 await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/#/v1',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Staking Arena'})).toBeVisible();
 await page.getByRole('link',{name:/Vault aaaaaa/}).click();await expect(page.getByRole('heading',{name:/Vault aaaaaa/})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByText('Maximum reward per period',{exact:true})).toBeVisible();
 await expect(page.getByRole('table')).toBeVisible();
 await expect(page.getByRole('row').nth(1)).toContainText('Offer #01');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Connect Wallet'})).toBeVisible();
});
test('mobile preview forms are usable without suggesting wallet functionality',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id+'/offer',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();
 for(const [label,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const)await page.getByRole('textbox',{name:label}).fill(value);
 await expect(page.getByText('9,000 raw token units',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Make an Offer'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/#/create',{waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Review funding in wallet'})).toBeDisabled();
 await expect(page.getByRole('option')).toHaveCount(6);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('retains snapshot labels across outage, reload and navigation, then recovers',async({page})=>{
 let offline=false;await page.route('**/api/vaults',route=>offline?route.abort():route.fulfill({json:fixture()}));
 await page.goto('/#/vault/'+id,{waitUntil:'domcontentloaded'});await expect(page.getByText('Verified indexer data',{exact:true})).toBeVisible();
 offline=true;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('not current');
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByRole('alert')).toContainText('Saved indexed snapshot');await expect(page.getByText('Period at snapshot',{exact:true})).toBeVisible();
 const offerLink=page.getByRole('link',{name:'Make an Offer'});
 await expect(offerLink).toBeDisabled();await expect(offerLink).toHaveAttribute('aria-disabled','true');await expect(offerLink).not.toHaveAttribute('href');
 // Preview deep links remain readable while stale data blocks submission.
 await page.goto('/#/vault/'+id+'/offer',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Make an Offer'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('not current');
 for(const [label,value] of [[/^Stake amount/,'3000'],[/^Lock duration/,'2'],[/^Reward requested/,'0.00001000'],[/^Maximum wins/,'3']] as const)await page.getByRole('textbox',{name:label}).fill(value);
 await expect(page.getByText('9,000 raw token units',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Make an Offer',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Refresh data',exact:true})).toBeEnabled();
 offline=false;await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
test('empty, malformed and stale API data never invent available vaults',async({page})=>{
 let state='empty';await page.route('**/api/vaults',route=>{const data=fixture();if(state==='empty')data.vaults=[];if(state==='stale')data.health.connected=false;return route.fulfill({json:state==='invalid'?{chain:'main'}:data});});
 await page.goto('/#/v1',{waitUntil:'domcontentloaded'});await expect(page.getByText('No vaults listed',{exact:true})).toBeVisible();
 state='invalid';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByRole('alert')).toContainText('incompatible or malformed');
 state='stale';await page.getByRole('button',{name:'Refresh data'}).click();await expect(page.getByText('Open for offers · at snapshot',{exact:true})).toBeVisible();
});

test('WizardConnect pairs on demand and Escape cancels the accessible mobile dialog',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 // Keep public relays out of the smoke test; pairing URI generation is local.
 let sockets=0;
 await page.routeWebSocket(/^wss:\/\//,()=>{sockets++;});
 await page.goto('/#/v1',{waitUntil:'domcontentloaded'});
 const connect=page.getByRole('button',{name:'Connect Wallet'});
 await expect(connect).toBeVisible();expect(sockets).toBe(0);
 // Native WebSocket silently discards sends after close; Playwright's mock
 // throws instead. Match native behavior for the SDK's async relay cleanup.
 await page.evaluate(()=>{
   const send=WebSocket.prototype.send;
   WebSocket.prototype.send=function(data){if(this.readyState>=WebSocket.CLOSING)return;send.call(this,data);};
 });
 await connect.click();
 const dialog=page.getByRole('dialog',{name:'Connect with WizardConnect'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('canvas')).toBeVisible();
 const uri=await dialog.getByRole('textbox',{name:'Connection URI'}).inputValue();
 expect(uri).toMatch(/^wiz:/i);
 await expect(dialog.getByRole('link',{name:'Open wallet'})).toHaveAttribute('href',uri);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);await expect(connect).toBeVisible();await expect(connect).toBeFocused();
 expect(await page.evaluate(()=>localStorage.getItem('staking-arena-wizardconnect-v1'))).toBeNull();
 expect(errors).toEqual([]);
});

test('unified asset selectors support all four pairs with keyboard and touch without a connected signing wallet',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.route('**/api/vaults',route=>route.fulfill({json:fixture()}));
 await page.goto('/#/create',{waitUntil:'domcontentloaded'});
 const staking=page.getByRole('combobox',{name:'Staking asset',exact:true}),reward=page.getByRole('combobox',{name:'Reward asset',exact:true});
 await expect(staking).toBeEnabled();await expect(reward).toBeEnabled();
 await page.getByLabel('Schedule starts (UTC)').fill('2027-01-01T00:00');await page.getByLabel('Period duration (seconds)').fill('60');await page.getByLabel('Number of periods').fill('3');
 for(const stake of ['bch','token'])for(const pay of ['bch','token']){
  await staking.selectOption(stake);await reward.selectOption(pay);
  if(stake==='token')await page.getByLabel('Staking asset category',{exact:false}).fill('ab'.repeat(32));
  else await expect(page.getByLabel('Staking asset category',{exact:false})).toHaveCount(0);
  if(pay==='token')await page.getByLabel('Reward token category',{exact:false}).fill('cd'.repeat(32));
  else await expect(page.getByLabel('Reward token category',{exact:false})).toHaveCount(0);
  await page.getByLabel(/^Maximum reward per period/).fill(pay==='bch'?'0.00002000':'7');
  const reserve=page.locator('.calculation dl > div').filter({has:page.getByText('Total upfront reward reserve',{exact:true})});
  await expect(reserve).toContainText(pay==='bch'?'0.00006000 BCH (6000 satoshis)':'21 raw token units · '+'cd'.repeat(32));
  await expect(page.getByRole('button',{name:'Review funding in wallet',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await staking.focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await expect(staking).toHaveValue('bch');
 await expect(page.getByLabel('Staking asset category',{exact:false})).toHaveCount(0);
 await page.goto('/#/v2');await page.getByRole('link',{name:/Create Vault/}).click();await expect(page).toHaveURL(/#\/create$/);
});
