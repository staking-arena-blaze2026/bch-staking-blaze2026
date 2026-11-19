import type {Intent,Operation} from '../../src/queue/wallet';
import type {WalletKey} from '../../src/transactions-core';
import {activeNetwork} from './activeNetwork';
import {queueCall} from './queueClient';
import {deriveWalletKey,walletChains} from './walletDerivation';
import type {PublicPath} from './walletNetwork';

type DeriveHint=(path:WalletKey['path'],index:number)=>WalletKey|undefined;

/** Both watch-only and live requests search the same branches and journal hints. */
export async function discoverQueueInputs(
 request:Record<string,unknown>,
 keys:(limit:number)=>WalletKey[],
 deriveHint:DeriveHint,
 check:()=>void,
):Promise<{operation:Operation;descriptors:WalletKey[]}> {
 const preview=request.operation==='previewCreate';
 const preparing=preview||request.operation==='prepare';
 const kind=(request.intent as Intent|undefined)?.kind;
 const limits=preparing&&kind!=='recover'?[2,8,16,24,32,40]:[40];
 const discoveryId=crypto.randomUUID();
 const saved=preparing&&kind==='create'?await queueCall({operation:'list'}):[];
 const journal:Operation[]=Array.isArray(saved)?saved:[];
 for(const limit of limits){
  check();
  window.dispatchEvent(new CustomEvent('arena-wallet-progress',{detail:'Finding available wallet funds — checking '+limit+' addresses per path…'}));
  const start=performance.now(),descriptors=keys(limit);
  window.dispatchEvent(new CustomEvent('arena-wallet-timing',{detail:{stage:'public-key-derivation',milliseconds:performance.now()-start}}));
  const owner=descriptors.find(k=>k.path==='receive'&&k.index===0);
  for(const op of journal){
   if(op.owner?.publicKey!==owner?.publicKey)continue;
   for(const hint of op.keys??[]){
    if(!Number.isSafeInteger(hint.index)||hint.index<0||hint.index>=200||descriptors.some(k=>k.path===hint.path&&k.index===hint.index)||!Object.values(op.plan?.signers??{}).includes(hint.publicKey))continue;
    const key=deriveHint(hint.path,hint.index);
    if(key?.publicKey===hint.publicKey)descriptors.push({...key,fundingHint:true});
   }
  }
  let operation:Operation;
  try{operation=await queueCall({...request,discoveryId},descriptors);}
  catch(error){
   const funding=(error as {details?:{code?:string}})?.details?.code?.includes('funding')||/Insufficient|funding is required|funding for|funding propagates|Atomic vault creation needs/i.test(String(error));
   if(limit===40||!funding)throw error;
   continue;
  }
  try{check();}
  catch(error){
   if(!preview&&preparing&&operation?.stage==='review'&&!operation.raw)await queueCall({operation:'discard',id:operation.id}).catch(()=>{});
   throw error;
  }
  if(!preparing||operation?.intent?.kind!=='create'||operation.quote?.transactions===1||limit===40)return {operation,descriptors};
  // Continue searching before offering a multi-transaction fallback. A preview
  // has no durable journal or reservations to release between scan batches.
  if(!preview)await queueCall({operation:'discard',id:operation.id});
 }
 throw Error('Wallet discovery did not return a queue plan');
}

export async function prepareQueueCreate(intent:Extract<Intent,{kind:'create'}>,paths:readonly PublicPath[],check:()=>void):Promise<Operation>{
 check();
 const branches=walletChains.filter(([path])=>paths.some(p=>p.name===path));
 if(!branches.some(([path])=>path==='receive'))throw Error('Open Cashonize to share the wallet receive path.');
 const cache=new Map<string,WalletKey>();
 const derive=(path:WalletKey['path'],index:number)=>{
  if(!branches.some(([name])=>name===path))return undefined;
  const id=path+':'+index;
  let key=cache.get(id);
  if(!key){key=deriveWalletKey(paths,path,index,activeNetwork==='mainnet'?'mainnet':'testnet');cache.set(id,key);}
  return key;
 };
 const keys=(limit:number)=>{
  const descriptors:WalletKey[]=[];
  for(let index=0;index<limit;index++)for(const [path]of branches)descriptors.push(derive(path,index)!);
  return descriptors;
 };
 const {operation}=await discoverQueueInputs({operation:'previewCreate',intent},keys,derive,check);
 return operation;
}
