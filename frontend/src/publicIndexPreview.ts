import {warmPublicIndex} from './publicIndexTransport';
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
 const deadline=setTimeout(()=>{if(root.isConnected&&!root.hidden)root.append(el('p','Vault verification is taking longer than expected. Reload to retry; financial actions remain unavailable.'));},15000);
 window.addEventListener('hashchange',changed);
 void warmPublicIndex(network as V3Network).then(data=>{
  if(!root.isConnected||!location.hash.startsWith('#/v3/offers'))return;
  const rows=new Map<string,any>(),conflicts=new Set<string>();
  for(const row of data.vaults){const c=row?.config;
   if(!/^[a-f0-9]{64}$/.test(row?.announcement??'')||!Number.isSafeInteger(row?.height)||row.height< -1||!['observed-confirmed','provisional','not-observed'].includes(row?.status))continue;
   if(!c||c.version!==3||!(/^[a-f0-9]{64}$/.test(c.genesis))||c.registryVersion!==undefined&&c.registryVersion!==4||!/^\d{1,7}$/.test(String(c.cap))||Number(c.cap)<1||Number(c.cap)>1000000||![c.epoch,c.periodSeconds,c.periods].every(Number.isSafeInteger)||c.epoch<500000000||c.periodSeconds<1||c.periods<1||c.periods>16||c.epoch+c.periodSeconds*c.periods>2147483647||c.discovery!==undefined&&c.discovery!==1)continue;
   const validAsset=(a:any)=>a?.kind==='bch'||a?.kind==='token'&&/^[a-f0-9]{64}$/.test(a.category);if(!validAsset(c.stakingAsset)||!validAsset(c.rewardAsset)||c.rewardAsset.kind==='bch'&&Number(c.cap)<1000)continue;
   if(rows.has(c.genesis)&&JSON.stringify(rows.get(c.genesis).config)!==JSON.stringify(c))conflicts.add(c.genesis);else rows.set(c.genesis,row);
  }
  if(!rows.size)return;
  root.replaceChildren(el('h1','Staking Arena'),el('h2','Known vaults'),el('p',`${network} · Public candidates. Immutable parameters are unverified hints. Financial state requires independent blockchain verification.`));
  for(const [id,row]of rows){if(conflicts.has(id))continue;const c=row.config,card=document.createElement('a');card.className='v3-vault-card';card.href=`#/v3/vault/${id}`;card.style.cssText='display:block;color:inherit;text-decoration:none;border:1px solid #b9cec5;border-radius:12px;padding:16px;margin:12px 0;background:#fff';
   card.append(el('h3',`${c.registryVersion===4?'Atomic V4':'V3'} vault ${id.slice(0,16)} → Make an Offer`),el('p',`Genesis transaction: ${id} · Unverified candidate${row.status==='provisional'?' · Pending (0-conf), provisional':row.status==='not-observed'?' · Retained, not currently observed':''}`));
   const asset=(a:any)=>a.kind==='bch'?'BCH':`CashToken ${a.category}`;
   card.append(el('p',`Staking: ${asset(c.stakingAsset)} · Rewards: ${asset(c.rewardAsset)} · Maximum reward per period: ${c.cap} ${c.rewardAsset.kind==='bch'?'BCH satoshis':'raw token units'} · Interval: ${c.periodSeconds}s · Releases: ${c.periods} · Schedule epoch: ${c.epoch}. Unverified configuration hints.`),el('p','Financial state unavailable until blockchain verification succeeds.'));
   root.append(card);
  }
  root.hidden=false;
 }).catch(()=>remove());
}
