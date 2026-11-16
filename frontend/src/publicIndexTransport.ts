import type {V3Network} from '../../src/v3/network';
// Kept free of React, wallet SDKs, covenant artifacts and cryptography libraries so
// the public list can render while the full application downloads and initializes.
async function fetchPage(network:V3Network,path:string,signal?:AbortSignal){
 if(!['mainnet','chipnet','regtest'].includes(network)||!(/^(index\.json|pages\/[a-f0-9]{64}\.json)$/.test(path)))throw Error('Invalid public index path');
 const response=await fetch(new URL(`public-index/${network}/${path}`,document.baseURI),{signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(8000)]),cache:path==='index.json'?'no-cache':'force-cache'});
 if(!response.ok)throw Error('Public index temporarily unavailable');
 if(Number(response.headers.get('content-length')??0)>262144)throw Error('Oversized public index');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty public index');const chunks:Uint8Array[]=[];let bytes=0;
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144){await reader.cancel();throw Error('Oversized public index');}chunks.push(value);}
 const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}const text=new TextDecoder().decode(body);
 const data=JSON.parse(text);if(data.schema!==1||data.network!==network)throw Error('Public index network/schema mismatch');
 if(!Array.isArray(data.vaults)||data.vaults.length>20)throw Error('Oversized index page');
 const pages=data.pages??[];if(!Array.isArray(pages)||pages.length>10000||pages.some((p:unknown)=>typeof p!=='string'||!/^pages\/[a-f0-9]{64}\.json$/.test(p)))throw Error('Invalid index pagination');
 if(path!=='index.json'){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(path!==`pages/${hash}.json`)throw Error('Public index page integrity mismatch');}
 return data;
}
let warmed:{network:V3Network;promise:Promise<any>;controller:AbortController;used:boolean}|undefined;
export function warmPublicIndex(network:V3Network){const controller=new AbortController();warmed={network,controller,used:false,promise:fetchPage(network,'index.json',controller.signal)};return warmed.promise;}
export function fetchPublicIndex(network:V3Network,path='index.json',signal?:AbortSignal):Promise<any>{
 if(path==='index.json'&&warmed?.network===network&&!warmed.used){const initial=warmed;initial.used=true;const abort=()=>initial.controller.abort();signal?.addEventListener('abort',abort,{once:true});return initial.promise.finally(()=>signal?.removeEventListener('abort',abort));}
 return fetchPage(network,path,signal);
}
