import {assetAmount,assetLabel} from './assetAmounts';
import {createBrandArtwork} from './brandArtwork';
import {fetchTokenMetadata} from './tokenMetadata';
import {catalogDate,catalogIsStale,queueCatalogColumns,queueConfigStorage,savedQueuePublicIds,warmQueuePage} from './queueCatalog';
import {queueCount,rememberQueueCount,countDescription} from './queueCounts';
import {queueReward,rememberQueueReward} from './queueRewards';
import {localTimestamp} from './localTime';
import type {TokenMetadata} from './tokenMetadata';
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
 const deadline=setTimeout(()=>{if(root.isConnected&&!root.hidden)(root.querySelector('main')??root).append(el('p','The full vault interface is still loading.'));},15000);
 window.addEventListener('hashchange',changed);
 const render=(data:{vaults:any[]})=>{
  if(!root.isConnected||!location.hash.startsWith('#/v3/offers'))return;
  const rows=new Map<string,any>(),conflicts=new Set<string>();
  for(const c of data.vaults){
   const p=c?.parameters;
   if(!p||!c.identity||!c.anchor||![c.anchor.genesis,c.identity.vault,c.identity.queue,p.stakingCategory,p.rewardCategory].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!/^(02|03)[a-f0-9]{64}$/.test(c.anchor.creator))continue;
   if(!/^\d{1,7}$/.test(String(p.cap))||Number(p.cap)<1||Number(p.cap)>1000000||![p.epoch,p.interval,p.releases].every(Number.isSafeInteger)||p.epoch<500000000||p.interval<1||p.releases<1||p.releases>1000||p.epoch+p.interval*p.releases>2147483647)continue;
   const config={genesis:c.anchor.genesis,cap:p.cap,periods:p.releases,stakingAsset:p.stakingCategory==='00'.repeat(32)?{kind:'bch'}:{kind:'token',category:p.stakingCategory},rewardAsset:p.rewardCategory==='00'.repeat(32)?{kind:'bch'}:{kind:'token',category:p.rewardCategory}};
   if(rows.has(config.genesis)&&JSON.stringify(rows.get(config.genesis).config)!==JSON.stringify(config))conflicts.add(config.genesis);else rows.set(config.genesis,{config,offerCount:c.offerCount,rewardSnapshot:c.rewardSnapshot});
  }
  for(const [id,row] of rows){
   if(conflicts.has(id))continue;
   rememberQueueCount(network,id,row.offerCount);
   rememberQueueReward(network,id,row.rewardSnapshot);
  }
  if(!rows.size||!root.hidden)return;
  const header=el('header','');header.className='header';header.append(createBrandArtwork());
  const nav=el('nav','');nav.setAttribute('aria-label','Main navigation');
  for(const [label,href]of [['About','#/about'],['My Offers','#/v3/my-offers']]){const link=el('a',label) as HTMLAnchorElement;link.href=href;nav.append(link);}header.append(nav);
  const main=el('main',''),arena=el('div','');arena.className='v3-arena';
  const tabs=el('nav','');tabs.className='v3-tabs';tabs.setAttribute('aria-label','V3 actions');
  for(const [label,href]of [['Create Vault','#/v3'],['Browse All Vaults','#/v3/offers']]){const link=el('a',label) as HTMLAnchorElement;link.href=href;if(href==='#/v3')link.className='create-vault-tab';else link.setAttribute('aria-current','page');tabs.append(link);}
  const panel=el('section','');panel.className='v3-known';panel.append(el('h2','Known vaults'));
  arena.append(tabs,panel);main.append(arena);root.replaceChildren(header,main);
  const refresh=el('button','Refresh public discovery') as HTMLButtonElement;refresh.disabled=true;panel.append(refresh);
  const updated=el('p','');panel.append(updated);
  let updatedAt='';
  const table=document.createElement('table');table.className='marketplace-table queue-marketplace';
  const head=table.createTHead().insertRow();for(const label of queueCatalogColumns){const th=el('th',label);th.setAttribute('scope','col');head.append(th);}
  const body=table.createTBody();let number=0;
  for(const [id,{config:c}]of rows){if(conflicts.has(id)||number>=20)continue;const row=body.insertRow(),link=el('a',String(++number)) as HTMLAnchorElement;link.className='marketplace-link';link.href=`#/v3/vault/${id}`;link.setAttribute('aria-label',`Vault ${number}`);row.insertCell().append(link);
   const reward=queueReward(network,id),schedule=reward?.schedule;
   const remaining=row.insertCell(),release=row.insertCell(),available=row.insertCell();
   const stale=reward&&catalogIsStale(reward.updatedAt)?' · Stale':'';
   const rewardAsset=c.rewardAsset;
   const displayRewards=(metadata?:TokenMetadata)=>{
    remaining.textContent=reward?assetAmount(rewardAsset,BigInt(reward.remaining),metadata)+stale:'Unavailable';
    available.textContent=schedule?assetAmount(rewardAsset,BigInt(schedule.available),metadata)+stale:'Unavailable';
   };
   remaining.dataset.label=queueCatalogColumns[1];
   release.dataset.label=queueCatalogColumns[2];
   available.dataset.label=queueCatalogColumns[3];
   if(!schedule)release.textContent='Unavailable';
   else if(schedule.nextRelease===null)release.textContent='All releases unlocked'+stale;
   else {
    const time=el('time',localTimestamp(schedule.nextRelease));
    time.setAttribute('datetime',new Date(schedule.nextRelease*1000).toISOString());
    release.append(time,stale);
   }
   displayRewards();
   if(reward&&rewardAsset.kind==='token'){
    void fetchTokenMetadata(network as V3Network,rewardAsset.category).then(metadata=>{if(remaining.isConnected)displayRewards(metadata);});
   }
   const staking=row.insertCell(),asset=c.stakingAsset;
   staking.dataset.label=queueCatalogColumns[4];staking.textContent=assetLabel(asset);
   if(asset.kind==='token'){
    staking.title=asset.category;
    void fetchTokenMetadata(network as V3Network,asset.category).then(metadata=>{if(staking.isConnected)staking.textContent=assetLabel(asset,metadata);});
   }
   const offers=row.insertCell(),count=queueCount(network,id);offers.dataset.label='Offers';offers.textContent=count?String(count.waiting)+(catalogIsStale(count.updatedAt)?' · Stale':''):'Unavailable';
   offers.title=count?countDescription(count):'Waiting offer count unavailable';
   for(const value of [reward,count])if(value&&(!updatedAt||Date.parse(value.updatedAt)>Date.parse(updatedAt)))updatedAt=value.updatedAt;
  }
  updated.append('Last updated: ');
  if(updatedAt){
   const time=el('time',catalogDate(updatedAt));time.setAttribute('datetime',updatedAt);
   updated.append(time,catalogIsStale(updatedAt)?' · Stale':'');
  }else updated.append('Unavailable');
  panel.append(table);
  root.hidden=false;
 };
 try{
  const cached=JSON.parse(localStorage.getItem(queueConfigStorage(network))??'[]');
  const published=savedQueuePublicIds(network);
  if(Array.isArray(cached))render({vaults:cached.filter(v=>published.has(v?.anchor?.genesis)).slice(0,20)});
 }catch{/* The published index can still populate the startup view. */}
 void warmQueuePage(network as V3Network).then(render).catch(()=>{if(root.hidden)remove();});
}
