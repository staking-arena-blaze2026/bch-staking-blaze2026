import {readFile,writeFile} from 'node:fs/promises';
const directory='docs/blaze2026/linked-queue/',out=directory+'phase2/';
const read=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const before=await read(out+'baseline/cost-comparison.json'),after=await read(out+'cost-comparison.json');
const pairNames=['BCH/BCH','BCH/token','token/BCH','token/token','same token'];
const vmRows=after.rows.flatMap((r:any,i:number)=>Object.entries(r.after).map(([action,value])=>{
 const b=before.rows[i].after[action],a=value as any;
 const total=(v:any,key:string)=>v.resources.reduce((n:number,r:any)=>n+r[key],0);
 return {pair:pairNames[i],action,before:{bytes:b.bytes,fee:b.fee,inputs:b.inputs,outputs:b.outputs,operationCost:total(b,'operationCost'),hashIterations:total(b,'hashIterations')},after:{bytes:a.bytes,fee:a.fee,inputs:a.inputs,outputs:a.outputs,operationCost:total(a,'operationCost'),hashIterations:total(a,'hashIterations')}};
}));
const oldPerformance=await read(out+'baseline/performance.json'),performance=await read(out+'performance.json');
const runtimeRows=performance.rows.flatMap((r:any,i:number)=>{
 const group=(row:any,kind:string)=>row.actions.filter((a:any)=>a.kind===kind);
 const total=(rows:any[])=>rows.reduce((v:any,a:any)=>({bytes:v.bytes+a.bytes,fee:v.fee+a.fee,approvals:v.approvals+a.approvals,calls:v.calls+a.prepareCalls+a.authorizeCalls+a.signatureToPendingCalls,authorizeCalls:v.authorizeCalls+a.authorizeCalls,readinessMs:v.readinessMs+a.prepareMs+a.authorizeMs,signatureToPendingMs:v.signatureToPendingMs+a.signatureToPendingMs}),{bytes:0,fee:0,approvals:0,calls:0,authorizeCalls:0,readinessMs:0,signatureToPendingMs:0});
 return ['create','insert','cancel','claim','withdraw'].map(kind=>({pair:pairNames[i],action:kind,...(kind==='insert'?{note:'Sum of empty and ordinary insertion; two separate one-approval actions'}:{}),before:total(group(oldPerformance.rows[i],kind)),after:total(group(r,kind))}));
});
await writeFile(out+'comparison.json',JSON.stringify({at:new Date().toISOString(),baseline:'9726d5d',method:'See README measurement boundary. VM costs are summed across inputs; per-input limits remain in cost-comparison.json. Complete action runtime includes preparation transactions. Insert row sums two actions.',vmRows,runtimeRows},null,2)+'\n');
let md='# Before/after measurements\n\nBaseline: `9726d5d`. Signed Schnorr transactions at 1 sat/byte. Bytes therefore equal miner fees in sats. VM operations and hash iterations below sum all inputs; per-input limits are in the JSON evidence.\n\n';
for(const pair of pairNames){md+=`## ${pair}: deterministic signed bytes and VM resources\n\n| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |\n| --- | ---: | ---: | ---: | --- |\n`;for(const r of vmRows.filter((r:any)=>r.pair===pair))md+=`| ${r.action} | ${r.before.bytes} → ${r.after.bytes} | ${r.before.operationCost} → ${r.after.operationCost} | ${r.before.hashIterations} → ${r.after.hashIterations} | ${r.before.inputs}/${r.before.outputs} → ${r.after.inputs}/${r.after.outputs} |\n`;md+='\n';}
md+='## Complete user actions\n\nIncludes queue/seed creation preparations. Creation totals exclude the separate 1,000-sat announcement output and protected vault/root/gate carriers, which are not miner fees. The insert row sums **two actions** (empty plus ordinary), hence two approvals. All other non-creation rows represent one action.\n\nTiming is one synthetic local sample, not public-network or Cashonize latency. Calls are Electrum facade invocations, **not actual wire RPC counts**; see README. Preparation + authorization is approval readiness; human approval time is excluded.\n\n| Assets | Action | Total bytes/fee before → after | Calls before → after | Authorization calls before → after | Readiness ms before → after | Signature-to-Pending ms before → after | Approvals before → after |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n';
for(const r of runtimeRows){const b=r.before,a=r.after;md+=`| ${r.pair} | ${r.action} | ${b.bytes} → ${a.bytes} | ${b.calls} → ${a.calls} | ${b.authorizeCalls} → ${a.authorizeCalls} | ${Math.round(b.readinessMs)} → ${Math.round(a.readinessMs)} | ${Math.round(b.signatureToPendingMs)} → ${Math.round(a.signatureToPendingMs)} | ${b.approvals} → ${a.approvals} |\n`;}
await writeFile(out+'tables.md',md);
console.table(runtimeRows.filter((r:any)=>r.pair==='BCH/BCH'));
