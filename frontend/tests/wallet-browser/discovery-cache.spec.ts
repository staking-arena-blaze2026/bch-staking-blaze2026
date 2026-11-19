import {chromium,expect,test,type Page} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchOptions} from '../../scripts/browser-options.mjs';
import type {WalletDiscoveryStore} from '../../src/walletDiscoveryStore';

test('wallet and network discovery cache survives reload and browser restart, with atomic writes',async({baseURL})=>{
 const profile=await mkdtemp(join(tmpdir(),'arena-wallet-discovery-'));
 const start=async()=>{
  const context=await chromium.launchPersistentContext(profile,launchOptions);
  await context.route('**/wallet-cache-test',route=>route.fulfill({body:'<title>Discovery cache test</title>',contentType:'text/html'}));
  const page=context.pages()[0]??await context.newPage();
  await page.goto(baseURL+'/wallet-cache-test');
  return {context,page};
 };
 const wallet='a'.repeat(64),other='b'.repeat(64),endpoint='wss://wallet-test.invalid';
 let active:Awaited<ReturnType<typeof start>>|undefined;
 try{
  active=await start();
  const writeResult=await active.page.evaluate(async({wallet,endpoint})=>{
   const modulePath='/src/walletDiscoveryStore.ts';
   const {WalletDiscoveryStore:Store}=await import(/* @vite-ignore */ modulePath) as {WalletDiscoveryStore:typeof WalletDiscoveryStore};
   const store=new Store('mainnet',[endpoint]),lockingBytecode='76a914'+'1'.repeat(40)+'88ac',key={path:'receive' as const,index:3,publicKey:'02'+'2'.repeat(64)};
   const snapshot={scope:{id:wallet,expires:Date.now()+25000,keys:new Map([[lockingBytecode,key]]),peers:new Map([[endpoint,{tip:'3'.repeat(64),rows:new Map([[lockingBytecode,[{...key,utxo:{txid:'4'.repeat(64),vout:0,satoshis:6000n,lockingBytecode}}]]])}]])},evidence:[]};
   await store.save(wallet,snapshot);
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);this.transaction.abort();return result;};
   let aborted=false;
   try{await store.save(wallet,{...snapshot,scope:undefined},true);}catch{aborted=true;}
   finally{IDBObjectStore.prototype.put=put;}
   const saved=await store.load(wallet);
   return {aborted,index:saved?.keys[0]?.index,candidate:saved?.scope?.peers.get(endpoint)?.rows.get(lockingBytecode)?.[0]?.utxo.satoshis.toString()};
  },{wallet,endpoint});
  expect(writeResult).toEqual({aborted:true,index:3,candidate:'6000'});
  async function inspect(page:Page){
   return page.evaluate(async({wallet,other,endpoint})=>{
    const modulePath='/src/walletDiscoveryStore.ts';
    const {WalletDiscoveryStore:Store}=await import(/* @vite-ignore */ modulePath) as {WalletDiscoveryStore:typeof WalletDiscoveryStore};
    const mainnet=new Store('mainnet',[endpoint]),chipnet=new Store('chipnet',[endpoint]);
    return {loaded:(await mainnet.load(wallet))?.keys[0]?.index,other:!!await mainnet.load(other),chipnet:!!await chipnet.load(wallet)};
   },{wallet,other,endpoint});
  }
  await active.page.reload();
  expect(await inspect(active.page)).toEqual({loaded:3,other:false,chipnet:false});
  await active.context.close();active=undefined;
  active=await start();
  expect(await inspect(active.page)).toEqual({loaded:3,other:false,chipnet:false});
  const expired=await active.page.evaluate(async({wallet,endpoint})=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('staking-arena-wallet-discovery-mainnet');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
   });
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('wallets','readwrite'),store=tx.objectStore('wallets'),read=store.get(wallet);
    read.onsuccess=()=>{const entry=read.result;entry.scope.expires=Date.now()-1;store.put(entry,wallet);};
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
   });
   db.close();
   const modulePath='/src/walletDiscoveryStore.ts';
   const {WalletDiscoveryStore:Store}=await import(/* @vite-ignore */ modulePath) as {WalletDiscoveryStore:typeof WalletDiscoveryStore};
   const old=await new Store('mainnet',[endpoint]).load(wallet);
   return {hints:old?.keys.length,candidates:!!old?.scope};
  },{wallet,endpoint});
  expect(expired).toEqual({hints:1,candidates:false});
 }finally{await active?.context.close();await rm(profile,{recursive:true,force:true});}
});
