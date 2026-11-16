import {DISCOVERY_SCRIPT,discoveryScript} from '../../../src/v3/discovery';
import {ElectrumCore,scriptHash} from '../../../src/electrum-core';
import {emptyIndex,updatePublicIndex,stringify} from '../../../src/v3/public-index';
import {test,expect,type Page} from '@playwright/test';
import {v3BrowserChain} from '../../../tests/fixtures/v3-browser-chain';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {atomicOfferBuilder,genesisBuilder,covenant,parameterArgs} from '../../../src/v3/protocol';
import {directGenesisBuilder} from '../../../src/v3/protocol';
import {utxo} from '../../../src/arena-core';
import {binToHex,encodeTransaction,generateSigningSerializationBch,hash256,encodeDataPush,type Transaction} from '@bitauth/libauth';
let hiddenOffer:string|undefined,hideHosts:string[]=[];
let fixture:ReturnType<typeof v3BrowserChain>,hosts:string[]=[],methods:string[]=[],discoveryReads:string[]=[];
const certificate=mkdtempSync(tmpdir()+'/arena-v3-wss-');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',certificate+'/key','-out',certificate+'/cert','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
const server=createServer({key:readFileSync(certificate+'/key'),cert:readFileSync(certificate+'/cert')}),sockets=new WebSocketServer({server});
test.beforeAll(async()=>{sockets.on('connection',(socket,req)=>{hosts.push(req.headers.host??'');socket.on('message',async data=>{const m=JSON.parse(data.toString());methods.push(m.method);if(m.method==='blockchain.scripthash.get_history'&&[DISCOVERY_SCRIPT,discoveryScript('regtest')].map(scriptHash).includes(m.params[0]))discoveryReads.push(m.params[0]);try{const hide=hiddenOffer&&hideHosts.some(host=>(req.headers.host??'').startsWith(host));const wasPending=hide&&fixture.chain.pending.delete(hiddenOffer!);const response=fixture.chain.request(m.method,...m.params);if(wasPending)fixture.chain.pending.add(hiddenOffer!);const result=await response;socket.send(JSON.stringify({id:m.id,result}));}catch(e){socket.send(JSON.stringify({id:m.id,error:{code:-1,message:String(e)}}));}});});server.listen(4177,'0.0.0.0');await once(server,'listening');});
test.afterAll(async()=>{for(const s of sockets.clients)s.terminate();sockets.close();server.close();await once(server,'close');rmSync(certificate,{recursive:true,force:true});});
test.beforeEach(async({context})=>{fixture=v3BrowserChain();hiddenOffer=undefined;hideHosts=[];hosts=[];methods=[];discoveryReads=[];await context.routeWebSocket(/^wss:\/\/relay\./,s=>{s.onMessage(()=>{});});});
async function refresh(page:Page){const input=page.getByLabel('Public v3 configuration');if(!await input.isVisible())await page.getByText('Import or share a vault configuration',{exact:true}).click();if(!await input.inputValue())await input.fill(JSON.stringify(fixture.config,(_,v)=>typeof v==='bigint'?v.toString():v));const button=page.getByRole('button',{name:'Verify and refresh chain state'});await expect(button).toBeEnabled({timeout:60000});await button.click();await expect(page.getByRole('button',{name:'Refresh vault state',exact:true})).toBeEnabled({timeout:60000});await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible({timeout:60000});}
async function open(page:Page){await page.goto('./#/v3/offers');await page.getByText('Import or share a vault configuration',{exact:true}).click();await page.getByLabel('Public v3 configuration').fill(JSON.stringify(fixture.config,(_,v)=>typeof v==='bigint'?v.toString():v));await refresh(page);}
test('real browser worker verifies wallet-funded claims over WSS and requires a connected caller wallet',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await expect(page.getByRole('group',{name:'New v3 offer'}).getByRole('textbox')).toHaveCount(3);await expect(page.getByLabel('Maximum wins W')).toHaveCount(0);
 await expect(page.getByText(/Required staking commitment:/)).toContainText('3000 satoshis');
 await expect(page.getByRole('cell',{name:'513'})).toBeVisible();await expect(page.getByRole('button',{name:'Review and pay fee in wallet',exact:true})).toBeDisabled();
 await expect(page.getByText(/Claim unavailable: connect a compatible WizardConnect/)).toBeVisible();
 const claim=await fixture.claim();await refresh(page);expect(fixture.chain.pending.size).toBe(1);expect(fixture.chain.broadcasts).toHaveLength(1);
 await page.reload();await refresh(page);await expect(page.getByText(/Pending \(0-conf\) state verified/)).toBeVisible();
 fixture.chain.mine();
 await refresh(page);await expect(page.getByRole('cell',{name:'Active · #0 · Legacy offer: 1 reward payment remaining'})).toBeVisible();await expect(page.getByText(/effective lock 1024s/)).toBeVisible();
 expect(hosts.some(h=>h.startsWith('127.0.0.1'))).toBe(true);expect(hosts.some(h=>h.startsWith('localhost'))).toBe(true);expect(methods).toContain('blockchain.transaction.get_merkle');expect(errors).toEqual([]);
});
test('provider failure disables v3 actions and a reorganization restores the queue and allocation state',async({page})=>{
 await open(page);const claim=await fixture.claim();fixture.chain.mine();await refresh(page);await expect(page.getByText(/effective lock 1024s/)).toBeVisible();
 fixture.chain.reorgLastBlock();fixture.chain.pending.add(claim);await refresh(page);await expect(page.getByRole('cell',{name:'Pending (0-conf) · provisional · #0 · Legacy offer: 1 reward payment remaining'})).toBeVisible();await expect(page.getByText(/effective lock 1024s/)).toBeVisible();await expect(page.getByText(/Pending \(0-conf\) state verified/)).toBeVisible();await expect(page.getByRole('button',{name:'Review and pay fee in wallet',exact:true})).toBeDisabled();
 fixture.chain.mine();await refresh(page);await expect(page.getByRole('cell',{name:'Active · #0 · Legacy offer: 1 reward payment remaining'})).toBeVisible();
 fixture.chain.fail=true;await page.getByRole('button',{name:'Refresh vault state'}).click();await expect(page.getByRole('status')).toContainText('Waiting for a second verified provider',{timeout:60000});await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible();await expect(page.getByText(/Displayed state may be outdated/)).toBeVisible();
 fixture.chain.fail=false;await refresh(page);await expect(page.getByRole('cell',{name:'Active · #0 · Legacy offer: 1 reward payment remaining'})).toBeVisible();
});

test('direct genesis journal survives browser reload and automatically confirms its pending vault',async({page})=>{
 const coin=fixture.coin(1000000n),owner={publicKey:binToHex(fixture.key.publicKey),path:'receive' as const,index:0},parameters=fixture.config;
 const built=directGenesisBuilder(parameters,[{...owner,utxo:coin}],owner,fixture.provider),request=built.builder.generateWcTransactionObject({broadcast:false}),tx=structuredClone(request.transaction) as Transaction;
 const signature=fixture.key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:request.sourceOutputs,inputIndex:0},{coveredBytecode:request.sourceOutputs[0]!.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));signature[64]=0x61;
 tx.inputs[0]!.unlockingBytecode=new Uint8Array([...encodeDataPush(signature),...encodeDataPush(fixture.key.publicKey)]);
 const raw=binToHex(encodeTransaction(tx)),genesis=fixture.add(raw,false),config={...parameters,genesis:genesis.txid};
 const op={id:'direct-browser',version:3,kind:'create',creationMode:'direct',step:'action',stage:'pending',parameters,owner,raw,txid:genesis.txid,config,plan:{kind:'offer',label:'Direct browser genesis',request,signers:{0:owner.publicKey},inputPaths:[[0,'receive',0]],fee:'10000'}};
 const encoded=JSON.stringify(op,(_,v)=>typeof v==='bigint'?{bigint:v.toString()}:v instanceof Uint8Array?{bytes:Array.from(v)}:v);
 await page.goto('./#/v3');await page.getByRole('heading',{name:'Create a v3 vault'}).waitFor();
 await page.evaluate(async encoded=>{
 const op=JSON.parse(encoded,(_,v)=>v?.bigint!==undefined?BigInt(v.bigint):v?.bytes?Uint8Array.from(v.bytes):v);
 await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('staking-arena-wallet-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('operations','readwrite');t.objectStore('operations').put(op,op.id);t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});
 },encoded);
 await page.goto('./#/v3/offers');await page.reload();await expect(page.locator('.marketplace-table tbody tr')).toContainText('0-conf · provisional');
 await expect(page.getByRole('heading',{name:'Live ranked queue'})).toHaveCount(0);
 fixture.chain.mine();await expect(page.locator('.marketplace-table tbody tr')).not.toContainText('0-conf',{timeout:35000});await expect(page.locator('.marketplace-table tbody tr td').last()).toHaveText('0');
 await page.reload();await expect(page.locator('.marketplace-table tbody tr td').last()).toHaveText('0',{timeout:60000});
});

test('tabs preserve form values, verified rows open vault routes, and desktop/mobile layouts follow task order',async({page})=>{
 await page.setViewportSize({width:1360,height:1000});await page.goto('./#/v3');
 await page.getByLabel('Interval (seconds)',{exact:true}).waitFor({timeout:60000});await page.getByLabel('Interval (seconds)',{exact:true}).fill('7200');
 await page.getByRole('link',{name:'Make an Offer',exact:true}).click();await expect(page.getByRole('heading',{name:'Known vaults'})).toBeVisible();
 await page.goBack();await expect(page.getByLabel('Interval (seconds)',{exact:true})).toHaveValue('7200');await page.goForward();
 await page.getByText('Import or share a vault configuration',{exact:true}).click();await page.getByLabel('Public v3 configuration').fill(JSON.stringify(fixture.config,(_,v)=>typeof v==='bigint'?v.toString():v));await refresh(page);
 await page.getByRole('link',{name:'← Known vaults',exact:true}).click();
 const card=page.getByRole('link',{name:'Vault 1',exact:true});await expect(card.locator('xpath=ancestor::tr')).toContainText('0.00002000 BCH');await card.click();
 await expect(page).toHaveURL(new RegExp('#/v3/vault/'+fixture.config.genesis+'$'));await expect(page.locator('.v3-summary')).toBeVisible();
 const queue=await page.locator('.v3-queue').boundingBox(),form=await page.locator('.v3-offer').boundingBox();expect(queue!.x).toBeLessThan(form!.x);expect(form!.y).toBeLessThan(queue!.y);expect(await page.locator('.v3-queue .table-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'test-results/v3-redesign-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});const mobile=await Promise.all(['.v3-summary','.v3-offer','.v3-queue'].map(c=>page.locator(c).boundingBox()));expect(mobile[0]!.y).toBeLessThan(mobile[1]!.y);expect(mobile[1]!.y).toBeLessThan(mobile[2]!.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/v3-redesign-mobile.png',fullPage:true});
 await page.reload();await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible();expect(methods).not.toContain('blockchain.transaction.broadcast');
});

test('fresh independent profiles automatically discover V3 and Atomic V4 announcements without wallet connection',async({browser})=>{
 test.setTimeout(300000);
 const announced:string[]=[];
 for(const registryVersion of [undefined,4] as const){
  const coin=fixture.coin(1000000n),owner={publicKey:binToHex(fixture.key.publicKey),path:'receive' as const,index:0};
  const parameters={...fixture.config,discovery:1 as const,...(registryVersion?{registryVersion}:{})};
  const request=directGenesisBuilder(parameters,[{...owner,utxo:coin}],owner,fixture.provider).builder.generateWcTransactionObject({broadcast:false}),tx=structuredClone(request.transaction) as Transaction;
  const signature=fixture.key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:request.sourceOutputs,inputIndex:0},{coveredBytecode:request.sourceOutputs[0]!.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));signature[64]=0x61;
  tx.inputs[0]!.unlockingBytecode=new Uint8Array([...encodeDataPush(signature),...encodeDataPush(fixture.key.publicKey)]);
  announced.push(fixture.add(binToHex(encodeTransaction(tx)),true).txid);
 }
 const index=emptyIndex('regtest');await updatePublicIndex(index,[new ElectrumCore(()=>({connect:async()=>{},close:()=>{},request:fixture.chain.request}),{network:'regtest',endpoints:['wss://127.0.0.1']})]);
 for(const identity of ['Alice','Bob']){
  const profile=await browser.newContext({ignoreHTTPSErrors:true});await profile.routeWebSocket(/^wss:\/\/relay\./,socket=>socket.onMessage(()=>{}));
  await profile.route('**/public-index/regtest/index.json',route=>route.fulfill({contentType:'application/json',body:stringify({schema:1,network:'regtest',vaults:Object.values(index.candidates),total:announced.length,pages:[]})}));
  const page=await profile.newPage();await page.goto('http://127.0.0.1:4176/v3/#/v3/offers');
  for(const id of announced){const card=page.locator(`a[href="#/v3/vault/${id}"]`);await expect(card,identity+' sees public genesis').toBeVisible({timeout:60000});await expect(card.locator('xpath=ancestor::tr').locator('td').last()).toHaveText('0',{timeout:60000});}
  await page.locator(`a[href="#/v3/vault/${announced[1]}"]`).click();await expect(page.getByRole('button',{name:'Make an Offer',exact:true})).toBeDisabled();
  await expect(page.getByText(/Make an Offer unavailable: connect a compatible/)).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible({timeout:60000});
  fixture.chain.fail=true;await page.getByRole('button',{name:'Refresh vault state'}).click();await expect(page.getByRole('status')).toContainText('Waiting for a second verified provider',{timeout:60000});
  await page.goto('http://127.0.0.1:4176/v3/#/v3/offers');await expect(page.locator(`a[href="#/v3/vault/${announced[1]}"]`).locator('xpath=ancestor::tr')).toContainText('Unavailable');
  await page.reload();await expect(page.locator(`a[href="#/v3/vault/${announced[1]}"]`)).toBeVisible();
  fixture.chain.fail=false;await profile.close();
 }
 expect(methods).not.toContain('blockchain.transaction.broadcast');expect(discoveryReads).toEqual([]);
});

test('a thousand indexed candidates render bounded pages without a visitor history scan; malformed rows cannot authorize actions',async({page})=>{
 const {createHash}=await import('node:crypto');
 const candidates=Array.from({length:1000},(_,i)=>({config:{...fixture.config,genesis:(i+1).toString(16).padStart(64,'0')},announcement:(i+1).toString(16).padStart(64,'0'),height:0,status:'provisional'}));
 const second=stringify({schema:1,network:'regtest',vaults:candidates.slice(20,40)}),path='pages/'+createHash('sha256').update(second).digest('hex')+'.json';
 await page.route('**/public-index/regtest/index.json',route=>route.fulfill({contentType:'application/json',body:stringify({schema:1,network:'regtest',vaults:candidates.slice(0,20),total:1000,pages:[path]})}));
 await page.route('**/public-index/regtest/'+path,route=>route.fulfill({contentType:'application/json',body:second}));
 await page.goto('./#/v3/offers');await expect(page.locator('.marketplace-table tbody tr')).toHaveCount(20);await expect(page.locator('.marketplace-table tbody tr').first()).toContainText('Verifying…');
 await page.getByRole('button',{name:'Load more public vaults'}).click();await page.getByRole('button',{name:'Next vaults'}).click();await expect(page.locator('.marketplace-table tbody tr')).toHaveCount(20);await expect(page.locator('.marketplace-table tbody tr').first().getByRole('link',{name:'Vault 21',exact:true})).toHaveAttribute('href','#/v3/vault/'+candidates[20].config.genesis);
 await expect(page.getByRole('button',{name:'Make an Offer',exact:true})).toHaveCount(0);expect(methods).not.toContain('blockchain.scripthash.get_history');expect(methods).not.toContain('blockchain.transaction.broadcast');
});

test('simultaneous fresh visitors load the same public index without wallet identity or discovery-history reads',async({browser})=>{
 const contexts=await Promise.all([browser.newContext({ignoreHTTPSErrors:true}),browser.newContext({ignoreHTTPSErrors:true})]);let downloads=0;
 try{await Promise.all(contexts.map(async context=>{await context.routeWebSocket(/^wss:\/\/relay\./,s=>s.onMessage(()=>{}));await context.route('**/public-index/regtest/index.json',route=>{downloads++;return route.fulfill({contentType:'application/json',body:stringify({schema:1,network:'regtest',vaults:[{config:fixture.config,announcement:fixture.config.genesis,height:1,status:'observed-confirmed'}],total:1,pages:[]})});});const page=await context.newPage();await page.goto('http://127.0.0.1:4176/v3/#/v3/offers');await expect(page.locator('.marketplace-table tbody tr')).toHaveCount(1);expect(await page.evaluate(()=>localStorage.getItem('staking-arena-v3-configs'))).toBeNull();}));expect(downloads).toBe(2);expect(discoveryReads).toEqual([]);expect(methods).not.toContain('blockchain.transaction.broadcast');}finally{await Promise.all(contexts.map(c=>c.close()));}
});

test('accepted atomic offer is visible unranked through reload and asymmetric propagation, then automatically ranks and confirms',async({page})=>{
 const parameters={...fixture.config,registryVersion:4 as const},owner={publicKey:binToHex(fixture.key.publicKey),path:'receive' as const,index:0};
 const factory=covenant('RegistryAtomicGenesisV4',parameterArgs(parameters),fixture.provider),funding=fixture.coin(12000n,factory.lockingBytecode),reserve=fixture.coin(9000n);
 const g=genesisBuilder(parameters,funding,{input:reserve,unlocker:fixture.key.unlockP2PKH()},fixture.provider),genesis=fixture.add(g.builder.build()),config={...parameters,genesis:genesis.txid};
 const input=fixture.coin(100000n),terms={stake:3000n,duration:3600,reward:1000n,maxWins:1};
 const built=atomicOfferBuilder({parameters,category:funding.txid,state:g.state,inputs:[utxo(genesis,0),utxo(genesis,1),utxo(genesis,2)]},terms,fixture.key.publicKey,[{...owner,utxo:input}],fixture.provider,fixture.chain.clock(),fixture.key);
 const request=built.builder.generateWcTransactionObject({broadcast:false}),tx=structuredClone(request.transaction) as Transaction;
 for(const i of [0,3]){
  const source=request.sourceOutputs[i]!,sig=fixture.key.generateSignature(hash256(generateSigningSerializationBch({transaction:tx,sourceOutputs:request.sourceOutputs,inputIndex:i},{coveredBytecode:source.contract?.redeemScript??source.lockingBytecode,signingSerializationType:Uint8Array.of(0x61)})));sig[64]=0x61;
  tx.inputs[i]!.unlockingBytecode=source.contract?Buffer.from(Buffer.from(source.unlockingBytecode).toString('hex').replace('41'+'00'.repeat(65),'41'+binToHex(sig)),'hex'):new Uint8Array([...encodeDataPush(sig),...encodeDataPush(fixture.key.publicKey)]);
 }
 const raw=binToHex(encodeTransaction(tx)),submitted=fixture.add(raw,false);hiddenOffer=submitted.txid;hideHosts=['127.0.0.1','localhost'];
 const operation={id:'atomic-browser',version:3,kind:'offer',registrationMode:'atomic',step:'action',stage:'pending',observation:'propagating',parameters,owner,raw,txid:submitted.txid,source:genesis.txid,config,terms,plan:{kind:'offer',label:'Atomic fixture',request,signers:{0:owner.publicKey,3:owner.publicKey},inputPaths:[[0,'receive',0],[3,'receive',0]],fee:'10000'}};
 await page.goto('./#/v3');
 const encoded=JSON.stringify(operation,(_,v)=>typeof v==='bigint'?{bigint:v.toString()}:v instanceof Uint8Array?{bytes:Array.from(v)}:v);
 const acceptedAt=await page.evaluate(async({encoded,config})=>{
  const op=JSON.parse(encoded,(_,v)=>v?.bigint!==undefined?BigInt(v.bigint):v?.bytes?Uint8Array.from(v.bytes):v);op.acceptedAt=Date.now();
  localStorage.setItem('staking-arena-v3-configs',config);
  await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('staking-arena-wallet-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('operations');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('operations','readwrite');t.objectStore('operations').put(op,op.id);t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});return op.acceptedAt;
 },{encoded,config:JSON.stringify([config],(_,v)=>typeof v==='bigint'?v.toString():v)});
 await page.goto('./#/v3/vault/'+config.genesis);await page.reload();
 const provisional=page.getByRole('region',{name:'Locally submitted offers'});await expect(provisional).toContainText('Unranked');await expect(provisional).toContainText('Pending (0-conf) — awaiting on-chain verification');
 const visibleAt=Date.now();await expect(provisional).toContainText(submitted.txid);await expect(provisional).toContainText('3000 satoshis');
 await expect(page.locator('.v3-queue')).toContainText('No independently verified active offers yet');await expect(page.locator('.v3-queue')).toContainText(genesis.txid);
 // One provider observes the transaction while the other still reports the old state.
 hideHosts=['localhost'];await page.waitForTimeout(4000);await expect(provisional).toBeVisible();
 await page.reload();await expect(provisional).toContainText(submitted.txid);
 hideHosts=[];const propagatedAt=Date.now();
 await expect(provisional).toHaveCount(0,{timeout:45000});await expect(page.locator('.v3-queue')).toContainText(submitted.txid);await expect(page.locator('.v3-queue')).toContainText('Pending (0-conf)');
 const rankedAt=Date.now();fixture.chain.mine();
 await expect(page.locator('.v3-queue')).toContainText('Confirmed',{timeout:75000});
 const timing={fixture:'synthetic loopback WSS, real covenant/transaction verification; no BCH spent',acceptedToVisibleMs:visibleAt-acceptedAt,propagationToRankedMs:rankedAt-propagatedAt,acceptedToRankedMs:rankedAt-acceptedAt};
 console.log('SUBMITTED_OFFER_TIMING',JSON.stringify(timing));
 await page.screenshot({path:'test-results/submitted-offer-confirmed.png',fullPage:true});
 expect(methods).not.toContain('blockchain.transaction.broadcast');
});

test('fresh homepage is the four-column marketplace with accessible rows on desktop and mobile',async({page})=>{
 await page.route('**/public-index/regtest/index.json',route=>route.fulfill({contentType:'application/json',body:stringify({schema:1,network:'regtest',vaults:[{config:fixture.config,announcement:fixture.config.genesis,height:1,status:'observed-confirmed'}],pages:[]})}));
 await page.goto('./');await expect(page).toHaveURL(/#\/v3\/offers$/);await expect(page.getByRole('heading',{name:'Known vaults'})).toBeVisible();
 await expect(page.locator('.v3-tabs a').first()).toHaveText('Make an Offer');await expect(page.locator('.v3-tabs a').first()).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('link',{name:'Stake Arena home'})).toHaveAttribute('href','#/v3/offers');
 await expect(page.locator('.wallet-network-note')).toHaveCount(0);await expect(page.getByText(/Mainnet uses real BCH\. Review exact amounts/)).toHaveCount(0);
 await expect(page.getByRole('columnheader')).toHaveText(['Vault','Max reward / period','Staking asset','Offers']);
 expect(await page.getByRole('heading',{name:'Known vaults'}).evaluate(el=>el.nextElementSibling?.textContent)).toBe('Refresh public discovery');
 const row=page.locator('.marketplace-table tbody tr');await expect(row.locator('td').last()).toHaveText('1',{timeout:60000});
 for(const width of [1360,390]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/marketplace-${width}.png`,fullPage:true});}
 const link=page.getByRole('link',{name:'Vault 1',exact:true});await link.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp('#/v3/vault/'+fixture.config.genesis+'$'));await expect(page.getByRole('heading',{name:'Live ranked queue'})).toBeVisible();
 expect(methods).not.toContain('blockchain.transaction.broadcast');
});
