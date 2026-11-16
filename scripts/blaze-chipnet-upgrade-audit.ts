/** Read-only public chipnet forensics. No wallet, signing, broadcast, or latch changes. */
import {writeFile} from 'node:fs/promises';
import {Buffer} from '../src/bytes.js';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {headerHash,type Header} from '../src/electrum-core.js';
const endpoints=process.env.CHIPNET_RESTORE_AUDIT?['wss://chipnet.imaginary.cash:50004','wss://chipnet.bch.ninja:50004']:['wss://chipnet.imaginary.cash:50004','wss://electrum-chipnet.optnlabs.com','wss://chipnet.bch.ninja:50004'];
const activationMtp=1794744000,startHeight=332300,limit=8192,powLimit=BigInt('0x00000000'+'ff'.repeat(28));
function decode(height:number,hex:string){const b=Buffer.from(hex,'hex'),bits=b.readUInt32LE(72),exponent=bits>>>24,mantissa=bits&0x7fffff;
 const target=exponent<=3?BigInt(mantissa)>>BigInt(8*(3-exponent)):BigInt(mantissa)<<BigInt(8*(exponent-3));
 const hash=headerHash(hex),validTarget=!(bits&0x800000)&&target>0n&&target<=powLimit;
 return {height,hex,hash,parent:Buffer.from(b.subarray(4,36)).reverse().toString('hex'),time:b.readUInt32LE(68),merkle:Buffer.from(b.subarray(36,68)).reverse().toString('hex'),version:b.readInt32LE(0),bits:bits.toString(16).padStart(8,'0'),target:target.toString(16).padStart(64,'0'),powValid:validTarget&&BigInt('0x'+hash)<=target,work:validTarget?((1n<<256n)/(target+1n)).toString():'0'};
}
const observations:any[]=[];
for(const endpoint of endpoints){const p=new BrowserElectrumProvider({network:'chipnet',endpoints,allowBroadcast:false,timeoutMs:10000});try{observations.push(await p.session(async()=>{
 const features=await p.request('server.features').catch(e=>({error:String(e)})),banner=String(await p.request('server.banner').catch(e=>String(e))).slice(0,8192),subscription=await p.request('blockchain.headers.subscribe'),tip=await p.header(subscription.height);
 if(tip.hex!==subscription.hex)throw Error('Subscription/header mismatch');
 if(tip.height<startHeight||tip.height-startHeight+1>limit)throw Error('Forensic range exceeds bounded budget');
 const headers:ReturnType<typeof decode>[]=[];
 for(let at=startHeight;at<=tip.height;at+=2016){const count=Math.min(2016,tip.height-at+1),r=await p.request('blockchain.block.headers',at,count);if(r.count!==count||r.hex?.length!==count*160)throw Error('Incomplete range');for(let n=0;n<count;n++)headers.push(decode(at+n,r.hex.slice(n*160,(n+1)*160)));}
 for(let i=1;i<headers.length;i++)if(headers[i]!.parent!==headers[i-1]!.hash)throw Error('Unlinked range');
 if(headers.at(-1)!.hash!==tip.hash)throw Error('Range/tip mismatch');
 const mtpAt=(height:number)=>{const index=height-startHeight;if(index<10)return undefined;return headers.slice(index-10,index+1).map(h=>h.time).sort((a,b)=>a-b)[5];};
 const coinbases=[];for(const height of [332450,332451,332452]){try{const proof=await p.request('blockchain.transaction.id_from_pos',height,0,true),tx=await p.transaction(proof.tx_hash,height);coinbases.push({height,txid:tx.txid,raw:tx.hex,merkle:proof.merkle,outputSatoshis:tx.vout.reduce((n:bigint,o:any)=>n+BigInt(o.satoshis),0n).toString()});}catch(e){coinbases.push({height,error:String(e)});}}
 const newMinDifficultyContradictions=headers.flatMap((h,i)=>{if(i===0||(mtpAt(h.height-1)??0)<activationMtp||h.time-headers[i-1]!.time<=120||h.bits==='1d00ffff')return [];return [{height:h.height,hash:h.hash,parentMtp:mtpAt(h.height-1),parentTime:headers[i-1]!.time,time:h.time,secondsAfterParent:h.time-headers[i-1]!.time,actualBits:h.bits,expectedBits:'1d00ffff'}];});
 const crossing=headers.find(h=>(mtpAt(h.height)??0)>=activationMtp),mtp=await p.medianTime(tip.height,tip.hash),end=await p.request('blockchain.headers.subscribe');
 return {endpoint,coinbases,newMinDifficultyContradictions,observedAt:new Date().toISOString(),features,banner,tip,mtp,tipAgeSeconds:Math.floor(Date.now()/1000-tip.time),tipStable:end.height===tip.height&&end.hex===tip.hex,block332453:headers.find(h=>h.height===332453),firstMtpCrossing:crossing?{height:crossing.height,hash:crossing.hash,mtp:mtpAt(crossing.height),nextBlock:crossing.height+1}:null,headers,linked:true,allHeaderPowValid:headers.every(h=>h.powValid)};
 },endpoint));}catch(e){observations.push({endpoint,error:String(e)});}}
const good=observations.filter(o=>o.headers),commonHeaders:Header[]=[];
if(good.length>=2){for(let height=startHeight;height<=Math.min(...good.map(o=>o.tip.height));height++){const values=good.map(o=>o.headers[height-startHeight]);if(new Set(values.map(h=>h.hash)).size!==1)break;commonHeaders.push(values[0]);}}
const common=commonHeaders.at(-1);
for(const o of good)if(common){const tail=o.headers.filter((h:Header)=>h.height>common.height);o.workAfterCommon=tail.reduce((n:bigint,h:any)=>n+BigInt(h.work),0n).toString();o.commonAncestor={height:common.height,hash:common.hash};}
const report={at:new Date().toISOString(),activationMtp,startHeight,commonAncestor:common?{height:common.height,hash:common.hash}:null,warning:'Header hashes, linkage and PoW only: chainwork is not a substitute for contextual difficulty and full upgraded-node block validation.',observations};
await writeFile(process.env.CHIPNET_RESTORE_AUDIT?'docs/blaze2026/chipnet-upgrade/restoration-live.json':'docs/blaze2026/chipnet-upgrade/electrum-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({at:report.at,commonAncestor:report.commonAncestor,providers:observations.map(({headers,...o})=>o)},null,2));
