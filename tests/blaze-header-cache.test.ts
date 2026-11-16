import test from 'node:test';
import assert from 'node:assert/strict';
import {ElectrumCore,headerHash,type Header} from '../src/electrum-core.js';
function fixture(){
 const rows:string[]=[];let previous='00'.repeat(32),calls=0;
 for(let i=0;i<15;i++){const b=Buffer.alloc(80);Buffer.from(previous,'hex').reverse().copy(b,4);b.writeUInt32LE(i,68);const hex=b.toString('hex');rows.push(hex);previous=headerHash(hex);}
 const p=new ElectrumCore(()=>{throw Error('No transport');},{network:'mainnet'});p.endpoint='wss://a.test';
 p.request=async(method,...args)=>{assert.equal(method,'blockchain.block.headers');calls++;const start=Number(args[0]),count=Number(args[1]);return {count,hex:rows.slice(start,start+count).join('')};};
 const tip=(height:number)=>({height,hash:headerHash(rows[height]!)} as Header);
 return {p,tip,rows,calls:()=>calls};
}
test('linked headers reused only for an exact endpoint/tip and a covered range',async()=>{
 const f=fixture();await f.p.verifyHeaderChain(3,f.tip(14),new Map([[3,headerHash(f.rows[3]!)]]));assert.equal(f.calls(),1);
 await f.p.verifyHeaderChain(5,f.tip(14),new Map([[9,headerHash(f.rows[9]!)]]));assert.equal(f.calls(),1);
 await assert.rejects(f.p.verifyHeaderChain(5,f.tip(14),new Map([[9,'00'.repeat(32)]])),/mismatch/);assert.equal(f.calls(),1);
 f.p.endpoint='wss://b.test';await f.p.verifyHeaderChain(5,f.tip(14),new Map());assert.equal(f.calls(),2);
 await f.p.verifyHeaderChain(5,f.tip(13),new Map());assert.equal(f.calls(),3);
 await f.p.verifyHeaderChain(0,f.tip(14),new Map());assert.equal(f.calls(),4);
});
test('failed header verification never establishes reusable evidence',async()=>{
 const f=fixture();for(let i=0;i<2;i++)await assert.rejects(f.p.verifyHeaderChain(3,f.tip(14),new Map([[9,'00'.repeat(32)]])),/mismatch/);assert.equal(f.calls(),2);
});
