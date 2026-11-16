import { test, expect, type Page } from '@playwright/test';
import { Replay, headers, heights } from '../../../tests/fixtures/electrum-replay';
import { createServer } from 'node:https';
import { WebSocketServer } from 'ws';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { headerHash } from '../../../src/electrum';

// Captured real proofs for vault transactions; synthetic later headers make tests independent of wall-clock date.
function currentFixture() {
  const replay=new Replay();
  const first=Math.max(...heights.values())+1;
  let previous=headerHash(headers.get(first-1)!);
  for(let height=first;height<=replay.height;height++) {
    const bytes=Buffer.from(headers.get(height)!,'hex');Buffer.from(previous,'hex').reverse().copy(bytes,4);
    bytes.writeUInt32LE(Math.floor(Date.now()/1000)-(replay.height-height)*60,68);
    const hex=bytes.toString('hex');replay.forks.set(height,hex);previous=headerHash(hex);
  }
  return replay;
}
let active: Replay;
let methods: string[]=[], endpoints:string[]=[];
const certificate=mkdtempSync(tmpdir()+'/arena-wss-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certificate+'/key.pem','-out',certificate+'/cert.pem','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(certificate+'/key.pem'),cert:readFileSync(certificate+'/cert.pem')});
const sockets=new WebSocketServer({server});
test.beforeAll(async()=>{
  sockets.on('connection',(socket,request)=>{
    endpoints.push(request.headers.host??'');
    socket.on('message',async message=>{
      const request=JSON.parse(message.toString());methods.push(request.method);
      try {socket.send(JSON.stringify({id:request.id,result:await active.request(request.method,...request.params)}));}
      catch(error){socket.send(JSON.stringify({id:request.id,error:{code:-1,message:String(error)}}));}
    });
  });
  server.listen(4177,'0.0.0.0');await once(server,'listening');
});
test.afterAll(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();server.close();await once(server,'close');rmSync(certificate,{recursive:true,force:true});});
async function serveReplay(replay: Replay) {
  active=replay;methods=[];endpoints=[];return {methods,endpoints};
}
const ready = async(page:Page) => expect(page.getByTestId('electrum-status')).toContainText('Synchronized',{timeout:60000});

test('static worker reuses protocol/state validation and IndexedDB across reload, provider outage, and recovery',async({context,page})=>{
  const replay=currentFixture(), wire=await serveReplay(replay), errors:string[]=[], requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto('./#/v1');await ready(page);await expect(page.getByText('0.00002000 BCH')).toBeVisible();
  expect(wire.methods).toContain('blockchain.transaction.get_merkle');expect(wire.methods).toContain('blockchain.scripthash.listunspent');
  await page.getByRole('link',{name:/Vault a79f2b/}).click();await expect(page.getByRole('button',{name:'Withdrawn'})).toBeVisible();
  const count=await page.evaluate(async()=>new Promise<number>((resolve,reject)=>{
    const request=indexedDB.open('staking-arena-electrum-v1',1);
    request.onsuccess=()=>{const tx=request.result.transaction('checkpoints');const count=tx.objectStore('checkpoints').count();count.onsuccess=()=>resolve(count.result);tx.oncomplete=()=>request.result.close();};request.onerror=()=>reject(request.error);
  }));expect(count).toBe(1);
  replay.fail='Provider disconnected for fixture';
  await page.reload();await expect(page.getByRole('alert')).toContainText('Saved indexed snapshot');
  await expect(page.getByRole('alert')).toContainText('Provider disconnected for fixture');
  expect(wire.endpoints.some(e=>e.includes('localhost'))).toBe(true);
  replay.fail='';await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready(page);await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests.some(r=>r.includes('/api/')||r.includes(':3100')||r.includes(':48332'))).toBe(false);expect(errors).toEqual([]);
});

test('multiple tabs share one indexing lock and recover leadership when the owner closes',async({context,page})=>{
  await serveReplay(currentFixture());await page.goto('./#/v1');await ready(page);
  const second=await context.newPage();await second.goto('./#/v1');await ready(second);
  await expect(second.getByTestId('electrum-status')).toContainText('following another tab');
  await page.close();await expect(second.getByTestId('electrum-status')).not.toContainText('following another tab');await ready(second);
  await expect(second.getByText('0.00002000 BCH')).toBeVisible();
});

test('replacement branch restores a spent allocation; restoring the original chain detects its withdrawal again',async({context,page})=>{
  const replay=currentFixture();await serveReplay(replay);await page.goto('./#/v1');await ready(page);
  await page.getByRole('link',{name:/Vault a79f2b/}).click();await expect(page.getByRole('button',{name:'Withdrawn'})).toBeVisible();
  const originalForks=new Map(replay.forks);replay.cutoff=331820;
  let previous=headerHash(replay.getHeader(331820)!);
  for(let height=331821;height<=replay.height;height++) {
    const bytes=Buffer.from(replay.getHeader(height)!,'hex');Buffer.from(previous,'hex').reverse().copy(bytes,4);
    bytes.writeUInt32LE((bytes.readUInt32LE(76)^1)>>>0,76);
    const hex=bytes.toString('hex');replay.forks.set(height,hex);previous=headerHash(hex);
  }
  await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready(page);
  await expect(page.getByRole('button',{name:'Withdraw stake'})).toBeDisabled();
  replay.cutoff=undefined;replay.forks=originalForks;await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready(page);
  await expect(page.getByRole('button',{name:'Withdrawn'})).toBeVisible();
});

test('invalid inclusion evidence withholds new state and clearly reports the provider error',async({context,page})=>{
  const replay=currentFixture();replay.corruptProof=true;await serveReplay(replay);await page.goto('./#/v1');
  await expect(page.getByRole('alert')).toContainText('proof mismatch');await expect(page.getByText('Maximum reward / period')).toHaveCount(0);
  replay.corruptProof=false;await page.getByRole('button',{name:'Refresh data',exact:true}).click();await ready(page);
});


test('large histories fail at the configured cap without publishing partial state',async({context,page})=>{
  const replay=currentFixture(), request=replay.request;
  replay.request=async(method,...params)=>method==='blockchain.scripthash.get_history'
    ? Array.from({length:101},()=>({tx_hash:'ab'.repeat(32),height:331820})) : request(method,...params);
  await serveReplay(replay);await page.goto('./#/v1');
  await expect(page.getByRole('alert')).toContainText('history exceeds the configured limit');
  await expect(page.getByText('Maximum reward / period')).toHaveCount(0);
});

test('an IndexedDB write failure preserves the last committed snapshot and marks it stale',async({context,page})=>{
  await serveReplay(currentFixture());await page.goto('./#/v1');await ready(page);
  // The wallet worker is independent; inject failure into the indexing worker only.
  const worker=page.workers().find(worker=>/\/(?:arena|indexer\.bootstrap)\.worker-/.test(worker.url()));expect(worker).toBeDefined();
  await worker!.evaluate(()=>{IDBDatabase.prototype.transaction=function(){throw Error('IndexedDB quota failure for fixture');};});
  await page.getByRole('button',{name:'Refresh data',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('IndexedDB quota failure');
  await expect(page.getByText('0.00002000 BCH')).toBeVisible();
  await expect(page.getByText('Last-known indexed snapshot · not current')).toBeVisible();
});
