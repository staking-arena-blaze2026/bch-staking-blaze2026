// Explicit public-only release configuration. Never copy source or local runtime data into Pages.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const base=process.env.BLAZE_PAGES_BASE??'/staking-arena-site/';
if(!/^\/[a-zA-Z0-9_-]+\/$/.test(base))throw Error('Pages base must be a single project path ending in /');
const defaults=JSON.parse(await readFile(new URL('../../config/electrum-chipnet.json',import.meta.url),'utf8'));
const settlement=JSON.parse(await readFile(new URL('../../config/browser-settlement-chipnet.json',import.meta.url),'utf8'));
const env={...process.env,VITE_MIN_DISPLAY_CONFIRMATIONS:process.env.VITE_MIN_DISPLAY_CONFIRMATIONS??'0',VITE_INDEXER_MODE:'electrum',VITE_API_BASE_URL:'',VITE_ARENA_NETWORK:'chipnet',VITE_V3_NETWORK:'mainnet',VITE_ARENA_VAULTS:JSON.stringify([...defaults.vaults,...settlement]),VITE_ELECTRUM_ENDPOINTS:'wss://chipnet.imaginary.cash:50004,wss://chipnet.bch.ninja:50004',VITE_ELECTRUM_TIMEOUT_MS:'10000',VITE_ELECTRUM_POLL_MS:'15000',VITE_ELECTRUM_MAX_HISTORY:'50000',VITE_ELECTRUM_MAX_TRANSACTIONS:'20000',VITE_ELECTRUM_MAX_RAW_BYTES:'16777216'};
const run=args=>new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error('Build failed: '+code)));});
await run([resolve(root,'node_modules/typescript/bin/tsc'),'--noEmit']);
await run([resolve(root,'node_modules/vite/bin/vite.js'),'build','--base='+base,'--outDir=.pages-production']);
