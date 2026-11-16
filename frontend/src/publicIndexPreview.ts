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
  root.replaceChildren(el('h1','Stake Arena'),el('h2','Known vaults'));
  const refresh=el('button','Refresh public discovery') as HTMLButtonElement;refresh.disabled=true;root.append(refresh);
  const table=document.createElement('table');table.className='marketplace-table';
  const head=table.createTHead().insertRow();for(const label of ['Vault','Total max reward','Staking asset','Offers']){const th=el('th',label);th.setAttribute('scope','col');head.append(th);}
  const body=table.createTBody();let number=0;
  for(const [id,{config:c}]of rows){if(conflicts.has(id)||number>=20)continue;const row=body.insertRow(),link=el('a',String(++number)) as HTMLAnchorElement;link.className='marketplace-link';link.href=`#/v3/vault/${id}`;link.setAttribute('aria-label',`Vault ${number}`);row.insertCell().append(link);
   const asset=(a:any)=>a.kind==='bch'?'BCH':`CashToken ${a.category.slice(0,8)}…${a.category.slice(-8)}`;
   const total=BigInt(c.cap)*BigInt(c.periods),units=String(total).padStart(9,'0');
   const reward=`${c.rewardAsset.kind==='bch'?units.slice(0,-8)+'.'+units.slice(-8):total.toString()} ${asset(c.rewardAsset)}`;
   for(const [label,text] of [['Total max reward',reward],['Staking asset',asset(c.stakingAsset)],['Offers','Verifying…']]){const cell=row.insertCell();cell.dataset.label=label;cell.textContent=text;}

  }
  root.append(table);
  root.hidden=false;
 }).catch(()=>remove());
}
