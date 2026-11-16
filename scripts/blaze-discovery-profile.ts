/** Read-only profiling. No wallet, keys or broadcast capability. */
import {writeFile} from 'node:fs/promises';
import {WssConnection} from '../src/electrum-wss.js';
import {ElectrumCore} from '../src/electrum-core.js';
import {DISCOVERY_SCRIPT,parseAnnouncement} from '../src/v3/discovery.js';
import {AssetIndexer} from '../src/v3/indexer.js';
const calls:Record<string,{count:number;ms:number;bytes:number}>={};
const p=new ElectrumCore((endpoint,timeout)=>{const c=new WssConnection(endpoint,timeout);return {connect:()=>c.connect(),close:()=>c.close(),request:async(method,...args)=>{const start=performance.now();try{const value=await c.request(method,...args);const row=calls[method]??={count:0,ms:0,bytes:0};row.count++;row.ms+=performance.now()-start;row.bytes+=JSON.stringify(value).length;return value;}finally{}}};},{network:'mainnet',endpoints:['wss://bch.loping.net:50004','wss://bch.imaginary.cash:50004'],timeoutMs:8000});
const report:any={verificationPhases:[],at:new Date().toISOString(),calls,stages:[],broadcasts:0};
const stage=async(name:string,f:()=>Promise<unknown>)=>{const start=performance.now();try{const result=await f();report.stages.push({name,ms:performance.now()-start,result});return result;}catch(e){report.stages.push({name,ms:performance.now()-start,error:String(e)});}};
for(const peer of p.endpoints)await stage('legacy history '+peer,()=>p.session(async()=>{const h=await p.history(DISCOVERY_SCRIPT);return {entries:h.length};},peer));
const genesis='c14b3170fd156ee0b5cdefba0241981407a481caa08d7169b2e07ea5caccb2e5';
let config:any;
await stage('known announcement fetch and parse',()=>p.session(async()=>{const tx=await p.transaction(genesis),i=tx.vout.findIndex((o:any)=>o.scriptPubKey.hex===DISCOVERY_SCRIPT),{parameters}=parseAnnouncement(tx.vout[i+1].scriptPubKey.hex.slice(6));config={...parameters,genesis};const start=performance.now();for(let n=0;n<1000;n++)parseAnnouncement(tx.vout[i+1].scriptPubKey.hex.slice(6));report.meanParseMs=(performance.now()-start)/1000;return config;}));
if(config){await writeFile('docs/blaze2026/mainnet-vault-hint.json',JSON.stringify(config,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');await stage('independent genesis and full live replay',async()=>{const s=await new AssetIndexer(p,config,(phase,ms)=>report.verificationPhases.push({endpoint:p.endpoint,phase,ms})).sync();return {config:s.config,tip:s.tip,provisional:s.provisional,history:s.history,pending:s.pending,state:Buffer.from(s.instance.state).toString('hex')};});}
await writeFile(process.env.PROFILE_REPORT??'docs/blaze2026/discovery-profile.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');console.log(JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));
