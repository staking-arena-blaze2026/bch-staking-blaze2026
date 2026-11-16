/** Read-only real-network stage probe. No wallet, signing, journal or broadcast access. */
import {readFile,writeFile} from 'node:fs/promises';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {AssetIndexer} from '../src/v3/indexer.js';
import {verifyCoinsAcrossPeers} from '../src/electrum-wallet.js';
const index=JSON.parse(await readFile('frontend/public/public-index/mainnet/index.json','utf8'));
const config=index.vaults.find((v:any)=>v.config.registryVersion===4).config;config.cap=BigInt(config.cap);
const p=new BrowserElectrumProvider({network:'mainnet',allowBroadcast:false,timeoutMs:6000});
const counts:Record<string,number>={};const factory=p.connectionFactory;
// Record method names only; no scripts, transaction bytes, public keys or outpoints.
(p as any).connectionFactory=(endpoint:string,timeout:number)=>{const c=factory(endpoint,timeout),request=c.request;c.request=(method,...args)=>{counts[method]=(counts[method]??0)+1;return request(method,...args);};return c;};
const report:any={at:new Date().toISOString(),network:'mainnet',readOnly:true,limitations:'Public vault replay and input verification proxies; no wallet preparation, approval or broadcast measured.',runs:[]};
for(let run=0;run<2;run++){
 const row:any={run};let t=performance.now();try{const s=await new AssetIndexer(p,config).sync();row.replayMs=performance.now()-t;t=performance.now();await verifyCoinsAcrossPeers(p,s.instance.inputs,true);row.inputVerificationMs=performance.now()-t;}catch(e){row.error=String(e);row.elapsedMs=performance.now()-t;}row.requests={...counts};report.runs.push(row);console.log(JSON.stringify(row));
}
await writeFile(process.argv[2]??'/tmp/blaze-latency.json',JSON.stringify(report,null,2)+'\n');
