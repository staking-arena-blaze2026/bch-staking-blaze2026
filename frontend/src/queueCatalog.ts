/** Lightweight discovery transport; imported by the startup view before covenants. */
export const queueCatalogColumns=['Vault','Reward remaining','Next reward release','Reward available for claiming','Staking asset','Offers'] as const;
export const queueConfigStorage=(network:string)=>'staking-arena-queue-configs-'+network;

async function fetchQueuePage(network:string,path='index.json',signal?:AbortSignal,fresh=false){
 if(!['mainnet','chipnet','regtest'].includes(network)||!/^(index\.json|pages\/[a-f0-9]{64}\.json)$/.test(path))throw Error('Invalid queue index request');
 const url=new URL(`public-index/queue/${network}/${path}`,document.baseURI);
 if(fresh&&path==='index.json')url.searchParams.set('refresh',String(Date.now()));
 const response=await fetch(url,{signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(8000)]),cache:path==='index.json'?'no-store':'force-cache'});
 if(!response.ok)throw Error('Public queue index temporarily unavailable');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty queue index');const chunks=[];let bytes=0;
 for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>262144){await reader.cancel();throw Error('Oversized queue index');}chunks.push(r.value);}
 const all=new Uint8Array(bytes);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}const text=new TextDecoder().decode(all),data=JSON.parse(text);
 if(data.network!==network||!Array.isArray(data.vaults)||data.vaults.length>20||data.pages!==undefined&&(!Array.isArray(data.pages)||data.pages.length>10000||data.pages.some((p:unknown)=>typeof p!=='string'||!/^pages\/[a-f0-9]{64}\.json$/.test(p))))throw Error('Invalid queue index');
 if(path!=='index.json'){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',all)),b=>b.toString(16).padStart(2,'0')).join('');if(path!==`pages/${hash}.json`)throw Error('Queue index integrity mismatch');}
 return data;
}

let warmed:{network:string;promise:Promise<any>;used:boolean}|undefined;
export function warmQueuePage(network:string){warmed={network,used:false,promise:fetchQueuePage(network)};return warmed.promise;}
export function loadQueuePage(network:string,path='index.json',signal?:AbortSignal,fresh=false):Promise<any>{
 if(!fresh&&path==='index.json'&&warmed?.network===network&&!warmed.used){warmed.used=true;return warmed.promise;}
 return fetchQueuePage(network,path,signal,fresh);
}

export const catalogRefreshMs=90000;
export const catalogStaleMs=15*60*1000;
export const catalogDate=(updatedAt:string)=>new Date(updatedAt).toLocaleString(undefined,{timeZoneName:'short'});
export const catalogIsStale=(updatedAt:string,now=Date.now())=>now-Date.parse(updatedAt)>catalogStaleMs;
