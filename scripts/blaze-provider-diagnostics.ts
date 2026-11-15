import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {AssetIndexer,type Config} from '../src/v3/indexer.js';
const endpoints=['wss://chipnet.imaginary.cash:50004','wss://electrum-chipnet.optnlabs.com','wss://chipnet.bch.ninja:50004'];
const config:Config={version:3,genesis:'fa5bae8625e61ec15a9d1527157f1e544d6d4bee9a1a268095099320e33e8c86',stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1794738991,periodSeconds:360,periods:9,cap:1000n};
const observations=[];
for(const endpoint of endpoints){const p=new BrowserElectrumProvider({network:'chipnet',endpoints,timeoutMs:7000,allowBroadcast:false});try{observations.push(await p.session(async()=>{
 const tip=await p.tip(),mtp=await p.medianTime(tip.height,tip.hash),anchor=await p.header(332453);
 // Public vault only. No wallet descriptors, addresses or private journals are read.
 const indexer=new AssetIndexer(p,config);
 const replay=await (indexer as unknown as {replay:()=>Promise<any>}).replay().then(s=>({status:'verified-individually',stateTxid:s.instance.inputs[0].txid,utxos:s.instance.inputs.map((u:any)=>({txid:u.txid,vout:u.vout,satoshis:String(u.satoshis)})),ancestry:s.ancestry,pending:s.pending,history:s.history})).catch(e=>({status:'unavailable',error:String(e)}));
 return {endpoint,tip,mtp,anchor,replay};
 },endpoint));}catch(e){observations.push({endpoint,error:String(e)});}}
console.log(JSON.stringify({at:new Date().toISOString(),publicVault:config.genesis,observations},null,2));
