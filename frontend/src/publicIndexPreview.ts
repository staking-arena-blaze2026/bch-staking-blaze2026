import {createBrandArtwork} from './brandArtwork';
import {shortTokenCategory,tokenName} from './tokenNames';
import {warmQueuePage} from './queueCatalog';
import type {V3Network} from '../../src/v3/network';
/** Candidate hints only. This tiny startup view has no wallet, transaction or state
 * verification dependencies. React replaces it once its actual catalog is ready. */
export function startPublicPreview(){
 if(!location.hash.startsWith('#/v3/offers'))return;
 const network=new URLSearchParams(location.search).get('network')??import.meta.env.VITE_V3_NETWORK??'mainnet';
 if(!['mainnet','chipnet','regtest'].includes(network))return;
 const root=document.getElementById('arena-public-preview');if(!root)return;
 const el=(tag:string,text:string)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 const remove=()=>{root.remove();window.removeEventListener('hashchange',changed);clearTimeout(deadline);};
 const changed=()=>{if(!location.hash.startsWith('#/v3/offers'))remove();};
 const deadline=setTimeout(()=>{if(root.isConnected&&!root.hidden)(root.querySelector('main')??root).append(el('p','Vault verification is taking longer than expected. Reload to retry; financial actions remain unavailable.'));},15000);
 window.addEventListener('hashchange',changed);
 void warmQueuePage(network as V3Network).then(data=>{
  if(!root.isConnected||!location.hash.startsWith('#/v3/offers'))return;
  const rows=new Map<string,any>(),conflicts=new Set<string>();
  for(const c of data.vaults){
   const p=c?.parameters;
   if(!p||!c.identity||!c.anchor||![c.anchor.genesis,c.identity.vault,c.identity.queue,p.stakingCategory,p.rewardCategory].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!/^(02|03)[a-f0-9]{64}$/.test(c.anchor.creator))continue;
   if(!/^\d{1,7}$/.test(String(p.cap))||Number(p.cap)<1||Number(p.cap)>1000000||![p.epoch,p.interval,p.releases].every(Number.isSafeInteger)||p.epoch<500000000||p.interval<1||p.releases<1||p.releases>1000||p.epoch+p.interval*p.releases>2147483647)continue;
   const config={genesis:c.anchor.genesis,cap:p.cap,periods:p.releases,stakingAsset:p.stakingCategory==='00'.repeat(32)?{kind:'bch'}:{kind:'token',category:p.stakingCategory},rewardAsset:p.rewardCategory==='00'.repeat(32)?{kind:'bch'}:{kind:'token',category:p.rewardCategory}};
   if(rows.has(config.genesis)&&JSON.stringify(rows.get(config.genesis).config)!==JSON.stringify(config))conflicts.add(config.genesis);else rows.set(config.genesis,{config});
  }
  if(!rows.size)return;
  const header=el('header','');header.className='header';header.append(createBrandArtwork());
  const nav=el('nav','');nav.setAttribute('aria-label','Main navigation');
  for(const [label,href]of [['About','#/about'],['My Offers','#/v3/my-offers']]){const link=el('a',label) as HTMLAnchorElement;link.href=href;nav.append(link);}header.append(nav);
  const main=el('main',''),arena=el('div','');arena.className='v3-arena';
  const tabs=el('nav','');tabs.className='v3-tabs';tabs.setAttribute('aria-label','V3 actions');
  for(const [label,href]of [['Create Vault','#/v3'],['Browse All Vaults','#/v3/offers']]){const link=el('a',label) as HTMLAnchorElement;link.href=href;if(href==='#/v3')link.className='create-vault-tab';else link.setAttribute('aria-current','page');tabs.append(link);}
  const panel=el('section','');panel.className='v3-known';panel.append(el('h2','Known vaults'));
  arena.append(tabs,panel);main.append(arena);root.replaceChildren(header,main);
  const refresh=el('button','Refresh public discovery') as HTMLButtonElement;refresh.disabled=true;panel.append(refresh);
  const table=document.createElement('table');table.className='marketplace-table';
  const head=table.createTHead().insertRow();for(const label of ['Vault','Total max reward','Staking asset','Offers']){const th=el('th',label);th.setAttribute('scope','col');head.append(th);}
  const body=table.createTBody();let number=0;
  for(const [id,{config:c}]of rows){if(conflicts.has(id)||number>=20)continue;const row=body.insertRow(),link=el('a',String(++number)) as HTMLAnchorElement;link.className='marketplace-link';link.href=`#/v3/vault/${id}`;link.setAttribute('aria-label',`Vault ${number}`);row.insertCell().append(link);
   const total=BigInt(c.cap)*BigInt(c.periods),units=String(total).padStart(9,'0');
   const rewardAmount=c.rewardAsset.kind==='bch'?units.slice(0,-8)+'.'+units.slice(-8):total.toString();
   for(const [label,asset,qty] of [['Total max reward',c.rewardAsset,rewardAmount+' '],['Staking asset',c.stakingAsset,'']] as const){
    const cell=row.insertCell();cell.dataset.label=label;
    cell.textContent=qty+(asset.kind==='bch'?'BCH':shortTokenCategory(asset.category));
    if(asset.kind==='token'){
     cell.title=asset.category;
     void tokenName(network as V3Network,asset.category).then(name=>{if(name&&cell.isConnected)cell.textContent=qty+name;});
    }
   }
   const offers=row.insertCell();offers.dataset.label='Offers';offers.textContent='Verifying…';

  }
  panel.append(table);
  root.hidden=false;
 }).catch(()=>remove());
}
