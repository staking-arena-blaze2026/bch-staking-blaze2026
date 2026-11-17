import {act} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {startPublicPreview} from '../src/publicIndexPreview';
import {loadQueuePage} from '../src/queueCatalog';
const genesis='c14b3170fd156ee0b5cdefba0241981407a481caa08d7169b2e07ea5caccb2e5';
const config={anchor:{genesis,creator:'02'+'11'.repeat(32)},identity:{vault:'aa'.repeat(32),queue:'bb'.repeat(32)},parameters:{stakingCategory:'00'.repeat(32),rewardCategory:'00'.repeat(32),cap:'2000',releases:5,epoch:1794771663,interval:360}};
it('renders unverified hints without loading a wallet or chain libraries, then hands the same request to the full application',async()=>{
 window.location.hash='/v3/offers';document.body.innerHTML='<main id="arena-public-preview" hidden></main><div id="root"></div>';
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[config],pages:[]})));vi.stubGlobal('fetch',fetcher);
 await act(async()=>{startPublicPreview();await new Promise(r=>setTimeout(r,10));});
 const preview=document.getElementById('arena-public-preview')!;expect(preview.hidden).toBe(false);expect(preview.querySelector('header .brand-logo image')).toHaveAttribute('href','./assets/brand/stake-arena-logo-original.jpeg');expect(preview.querySelector('header img.brand-slogan')).toHaveAttribute('src','./assets/brand/stake-arena-slogan-v2.webp');expect(preview.textContent).toContain('Verifying…');expect(preview.textContent).toContain('0.00010000 BCH');expect(preview.textContent).not.toContain('provisional');expect(preview.textContent).not.toContain('Genesis transaction');expect(preview.querySelector('button')).toBeDisabled();expect(preview.querySelector('.marketplace-link')).toHaveAttribute('href','#/v3/vault/'+genesis);
 await loadQueuePage('mainnet');expect(fetcher).toHaveBeenCalledTimes(1);
 window.location.hash='/v3/vault/'+genesis;window.dispatchEvent(new HashChangeEvent('hashchange'));expect(document.getElementById('arena-public-preview')).toBeNull();document.body.replaceChildren();
});
it('does not render malformed or conflicting hints or HTML from index entries',async()=>{
 window.location.hash='/v3/offers';document.body.innerHTML='<main id="arena-public-preview" hidden></main>';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[config,{...config,parameters:{...config.parameters,cap:'3000'}},{...config,anchor:{...config.anchor,genesis:'<img src=x onerror=alert(1)>'}}],pages:[]}))));
 await act(async()=>{startPublicPreview();await new Promise(r=>setTimeout(r,10));});expect(document.querySelectorAll('.marketplace-table tbody tr')).toHaveLength(0);expect(document.querySelectorAll('img:not(.brand-slogan),[onerror]')).toHaveLength(0);window.location.hash='/v3';window.dispatchEvent(new HashChangeEvent('hashchange'));document.body.replaceChildren();
});
it('renders a 1000-release hint and rejects 1001 releases',async()=>{
 window.location.hash='/v3/offers';document.body.innerHTML='<main id="arena-public-preview" hidden></main>';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[{...config,parameters:{...config.parameters,releases:1000}},{...config,anchor:{...config.anchor,genesis:'aa'.repeat(32)},parameters:{...config.parameters,releases:1001}}],pages:[]}))));
 await act(async()=>{startPublicPreview();await new Promise(r=>setTimeout(r,10));});expect(document.querySelectorAll('.marketplace-table tbody tr')).toHaveLength(1);expect(document.getElementById('arena-public-preview')!.textContent).toContain('0.02000000 BCH');window.location.hash='/v3';window.dispatchEvent(new HashChangeEvent('hashchange'));document.body.replaceChildren();
});
