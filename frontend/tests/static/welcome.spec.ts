import {expect,test} from '@playwright/test';

test.use({storageState:{cookies:[],origins:[]}});

test('welcomes first-time visitors and remembers dismissal across reloads',async({page})=>{
 await page.setViewportSize({width:390,height:600});
 await page.goto('/');
 const welcome=page.getByRole('dialog',{name:'Welcome to Stake Arena'});
 await expect(welcome).toBeVisible();
 await expect(welcome.locator('strong').first()).toHaveText('Stake Arena');
 await expect(welcome.getByRole('heading',{name:'How It Works'})).toBeVisible();
 await expect(welcome.locator('em').last()).toHaveText('Priority Score = (Stake Amount × Lock Duration) / Requested Reward');
 await expect(welcome.getByRole('link',{name:'here'})).toHaveAttribute('href','https://pennypicker.pages.dev/t');
 await welcome.getByRole('button',{name:'Close welcome'}).click();
 await expect(welcome).toBeHidden();
 await page.waitForFunction(()=>localStorage.getItem('stake-arena-welcome-dismissed')==='1');
 await page.reload();
 await expect(welcome).toBeHidden();
});

test('opens and focuses the stablecoin section from the welcome link',async({page})=>{
 await page.goto('/');
 const welcome=page.getByRole('dialog',{name:'Welcome to Stake Arena'});
 const stablecoinLink=welcome.getByRole('link',{name:'novel stablecoin design'});
 await expect(stablecoinLink.locator('strong em')).toHaveText('novel stablecoin design');
 await stablecoinLink.click();
 await expect(welcome).toBeHidden();
 await expect(page).toHaveURL(/#\/about\/stablecoin$/);
 const stablecoin=page.locator('#stablecoin');
 await expect(stablecoin).toBeFocused();
 await expect(stablecoin).toBeInViewport();
});

test('opens the About page from the welcome link',async({page})=>{
 await page.goto('/');
 await page.getByRole('dialog').getByRole('link',{name:'See About'}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 await expect(page).toHaveURL(/#\/about$/);
 await expect(page.getByRole('heading',{name:'Stake Arena',exact:true})).toBeVisible();
});

test('dismisses the welcome dialog with Escape',async({page})=>{
 await page.goto('/');
 const welcome=page.getByRole('dialog',{name:'Welcome to Stake Arena'});
 await expect(welcome.getByRole('button',{name:'Close welcome'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(welcome).toBeHidden();
});
