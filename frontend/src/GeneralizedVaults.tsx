import {useEffect,useState} from 'react';
import {useWalletTransactions} from './walletTransactions';
import {useAssetAmounts} from './useAssetAmounts';
import {validateParameters} from '../../src/v2/model';
import type {Config} from '../../src/v2/indexer';
import type {Operation} from '../../src/v2/wallet';
const key='arena-local-vaults-v2';
export function readV2Configs():Config[]{
 try{return JSON.parse(localStorage.getItem(key)??'[]').slice(0,32).map((p:Config)=>{const config={...p,cap:BigInt(p.cap)};validateParameters(config);if(!/^[a-f0-9]{64}$/.test(config.genesis))throw Error('Invalid genesis');return config;});}catch{return [];}
}
export function saveV2Config(config:Config){
 const values=[config,...readV2Configs().filter(c=>c.genesis!==config.genesis)].slice(0,32);
 localStorage.setItem(key,JSON.stringify(values,(_,v)=>typeof v==='bigint'?v.toString():v));
}
export function configFromOperation(op:Operation):Config|undefined{
 if(op.config)return op.config;
 if(op.kind==='create'&&op.step==='action'&&op.txid)return {...op.parameters,genesis:op.txid};
}
export default function GeneralizedVaults(){
 const wallet=useWalletTransactions(),[configs,setConfigs]=useState(readV2Configs),[ops,setOps]=useState<Operation[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;setOps([]);setError('');void wallet?.v2?.({operation:'list'}).then(values=>{if(live)setOps(values);}).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[wallet]);
 const vaults=new Map(configs.map(config=>[config.genesis,{config,status:'Saved discovery hint · verify current status'}]));
 for(const op of ops){const config=configFromOperation(op);if(config&&(op.kind==='create'||!vaults.has(config.genesis)))vaults.set(config.genesis,{config,status:op.kind!=='create'?'Saved operation discovery hint · verify current status':op.step==='complete'?'Recovery record reports confirmed genesis · verify current status':'Pending / Unconfirmed (0-conf) genesis · recovery record'});}
 const {assetLabel,assetAmount}=useAssetAmounts('chipnet',[...vaults.values()].flatMap(({config})=>[config.stakingAsset,config.rewardAsset]));
 return <section className="panel"><h2>Experimental v2 vaults</h2><p>Local/imported discovery only. Saved records are historical; open a vault to verify canonical genesis and current balances on both providers. <a href="#/v2">Import or recover a v2 vault</a></p>{[...vaults.values()].map(({config:c,status})=><article key={c.genesis}><h3><a href={'#/v2/vault/'+c.genesis}>V2 vault {c.genesis.slice(0,12)}</a></h3><p>Staking: {assetLabel(c.stakingAsset)}. Reward: {assetLabel(c.rewardAsset)}. Maximum reward per period: {assetAmount(c.rewardAsset,c.cap)}. {status}.</p></article>)}{!vaults.size&&<p>No local v2 vault records.</p>}{error&&<p role="status">V2 recovery records unavailable: {error}</p>}<button type="button" onClick={()=>setConfigs(readV2Configs())}>Refresh local v2 discovery hints</button></section>;
}
