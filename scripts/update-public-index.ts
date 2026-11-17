/** Public read-only scanner. State persists across runs, including negative legacy results. */
import {mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {emptyIndex,updatePublicIndex,stringify,type IndexState} from '../src/v3/public-index.js';
const root=resolve(process.argv[2]??'frontend/public/public-index');
const networks=process.argv[3]?[process.argv[3]]:['mainnet','chipnet'];
for(const network of networks){
 if(network!=='mainnet'&&network!=='chipnet')throw Error('Invalid network');
 const dir=join(root,network);await mkdir(join(dir,'pages'),{recursive:true});
 let state:IndexState;try{state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));if(state.network!==network||state.schema!==1)throw Error('Invalid index state');for(const c of Object.values(state.candidates))c.config.cap=BigInt(c.config.cap);}catch(e:any){if(e.code!=='ENOENT')throw e;state=emptyIndex(network);}
 // Historical configurations are retained migration hints, not verification attestations.
 const legacy=JSON.parse(await readFile(network==='mainnet'?'frontend/public/v3-vaults-mainnet.json':'frontend/public/v3-vaults.json','utf8'));
 for(const config of legacy.vaults){config.cap=BigInt(config.cap);state.candidates[config.genesis]??={config,announcement:config.genesis,height:0,status:'not-observed'};}
 const defaults=new BrowserElectrumProvider({network,allowBroadcast:false});
 const providers=defaults.endpoints.map(endpoint=>new BrowserElectrumProvider({network,endpoints:[endpoint],timeoutMs:6000,allowBroadcast:false}));
 const result=await updatePublicIndex(state,providers,Number(process.env.INDEX_BUDGET??1500));
 const rank=(c:typeof state.candidates[string])=>c.status==='provisional'?Number.MAX_SAFE_INTEGER:c.status==='not-observed'?-2:c.height;
 const candidates=Object.values(state.candidates).sort((a,b)=>rank(b)-rank(a)||a.config.genesis.localeCompare(b.config.genesis));
 const pages=[];
 for(let at=20;at<candidates.length;at+=20){const content=stringify({schema:1,network,vaults:candidates.slice(at,at+20)}),hash=createHash('sha256').update(content).digest('hex'),path=`pages/${hash}.json`;await writeFile(join(dir,path),content);pages.push(path);}
 let previousPages:string[]=[];try{previousPages=JSON.parse(await readFile(join(dir,'index.json'),'utf8')).pages??[];}catch{}
 const retained=new Set([...pages,...previousPages]);for(const name of await readdir(join(dir,'pages')))if(!retained.has('pages/'+name))await rm(join(dir,'pages',name));
 const manifest={schema:1,network,updatedAt:state.updatedAt??null,revision:createHash('sha256').update(stringify(candidates)).digest('hex'),total:candidates.length,vaults:candidates.slice(0,20),pages,coverage:{...result,errors:result.errors.slice(0,3),legacyCatchupComplete:result.remaining===0},financialAuthority:false};
 await writeFile(join(dir,'state.json.tmp'),stringify(state));await rename(join(dir,'state.json.tmp'),join(dir,'state.json'));
 await writeFile(join(dir,'index.json.tmp'),stringify(manifest));await rename(join(dir,'index.json.tmp'),join(dir,'index.json'));
 console.log(network,JSON.stringify({...result,total:candidates.length}));
}
await import('./update-queue-index.js');
