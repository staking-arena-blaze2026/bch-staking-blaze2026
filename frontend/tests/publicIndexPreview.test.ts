import {act} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {startPublicPreview} from '../src/publicIndexPreview';
import {fetchPublicIndex} from '../src/publicIndexTransport';
const genesis='c14b3170fd156ee0b5cdefba0241981407a481caa08d7169b2e07ea5caccb2e5';
const config={version:3,registryVersion:4,genesis,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},cap:'1000',periods:5,epoch:1794771663,periodSeconds:360};
it('renders unverified hints without loading a wallet or chain libraries, then hands the same request to the full application',async()=>{
 window.location.hash='/v3/offers';document.body.innerHTML='<main id="arena-public-preview" hidden></main><div id="root"></div>';
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[{config,announcement:genesis,height:0,status:'provisional'}],pages:[]})));vi.stubGlobal('fetch',fetcher);
 await act(async()=>{startPublicPreview();await new Promise(r=>setTimeout(r,10));});
 const preview=document.getElementById('arena-public-preview')!;expect(preview.hidden).toBe(false);expect(preview.textContent).toContain('Verifying…');expect(preview.textContent).toContain('0.00001000 BCH · provisional');expect(preview.textContent).not.toContain('Genesis transaction');expect(preview.querySelector('button')).toBeDisabled();expect(preview.querySelector('a')).toHaveAttribute('href','#/v3/vault/'+genesis);
 await fetchPublicIndex('mainnet');expect(fetcher).toHaveBeenCalledTimes(1);
 window.location.hash='/v3/vault/'+genesis;window.dispatchEvent(new HashChangeEvent('hashchange'));expect(document.getElementById('arena-public-preview')).toBeNull();document.body.replaceChildren();
});
it('does not render malformed or conflicting hints or HTML from index entries',async()=>{
 window.location.hash='/v3/offers';document.body.innerHTML='<main id="arena-public-preview" hidden></main>';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({schema:1,network:'mainnet',vaults:[{config,announcement:genesis,height:0,status:'provisional'},{config:{...config,cap:'2000'},announcement:genesis,height:0,status:'provisional'},{config:{...config,genesis:'<img src=x onerror=alert(1)>'}}],pages:[]}))));
 await act(async()=>{startPublicPreview();await new Promise(r=>setTimeout(r,10));});expect(document.querySelectorAll('.marketplace-table tbody tr')).toHaveLength(0);expect(document.querySelectorAll('img')).toHaveLength(0);window.location.hash='/v3';window.dispatchEvent(new HashChangeEvent('hashchange'));document.body.replaceChildren();
});
