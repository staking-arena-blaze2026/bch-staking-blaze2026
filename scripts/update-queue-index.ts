/** Public discovery hints only. Every spending client authenticates genesis again. */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {emptyQueueIndex,scanQueueIndex,type QueueIndexState} from '../src/queue/public-index.js';
const stringify=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const root=join(resolve(process.argv[2]??'frontend/public/public-index'),'queue');
for(const network of process.argv[3]?[process.argv[3]]:['mainnet','chipnet']){
 if(network!=='mainnet'&&network!=='chipnet')throw Error('Invalid queue index network');
 const directory=join(root,network);await mkdir(join(directory,'pages'),{recursive:true});
 let state:QueueIndexState;
 try {
  state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
  if(state.network!==network)throw Error('Index network mismatch');
 }catch(e:any){
  if(e.code!=='ENOENT')throw e;
  state=emptyQueueIndex(network);
 }
 for(const a of Object.values(state.pending))a.parameters.cap=BigInt(a.parameters.cap);
 for(const c of Object.values(state.vaults))c.parameters.cap=BigInt(c.parameters.cap);
 const budget=Number(process.env.QUEUE_INDEX_BUDGET_MS??15000);
 if(!Number.isFinite(budget)||budget<1000||budget>60000)throw Error('Invalid queue index time budget');
 const provider=new BrowserElectrumProvider({network,allowBroadcast:false,timeoutMs:6000});
 const {online,errors,pending}=await scanQueueIndex(state,provider,budget);
 const vaults=Object.values(state.vaults).sort((a,b)=>a.anchor.genesis.localeCompare(b.anchor.genesis)),pages=[];
 for(let at=20;at<vaults.length;at+=20){const content=stringify({network,vaults:vaults.slice(at,at+20)}),hash=createHash('sha256').update(content).digest('hex'),path=`pages/${hash}.json`;await writeFile(join(directory,path),content);pages.push(path);}
 // Immutable pages precede the checkpoint and manifest. If interrupted
 // between replacements, the next run rebuilds the manifest from the checkpoint.
 const manifest={network,financialAuthority:false,updatedAt:new Date().toISOString(),total:vaults.length,vaults:vaults.slice(0,20),pages,online,pending,errors:errors.slice(0,2)};
 for(const [file,value]of [['state.json',state],['index.json',manifest]] as const){await writeFile(join(directory,file+'.tmp'),stringify(value));await rename(join(directory,file+'.tmp'),join(directory,file));}
 console.log(network,'queue index',JSON.stringify({vaults:vaults.length,pending:Object.keys(state.pending).length,errors:errors.length}));
}
