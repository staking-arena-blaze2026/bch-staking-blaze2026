import type {ElectrumCore} from './electrum-core.js';
/** Diagnostics contain stage labels and counts only, never request arguments or wallet data. */
export async function timed<T>(p:ElectrumCore,stage:string,work:()=>Promise<T>):Promise<T>{
 p.onStage?.(stage);
 const start=performance.now(),before={...p.requestCounts};let ok=false;
 try{const result=await work();ok=true;return result;}finally{const requests:Record<string,number>={};for(const [method,count]of Object.entries(p.requestCounts??{}))if(count!==(before[method]??0))requests[method]=count-(before[method]??0);p.onTiming?.({stage,milliseconds:performance.now()-start,requests,ok});}
}

/** Local CPU work (e.g. exact transaction size/fee convergence). */
export function timedSync<T>(p:ElectrumCore,stage:string,work:()=>T):T {
 const start=performance.now();let ok=false;
 try{const result=work();ok=true;return result;}finally{p.onTiming?.({stage,milliseconds:performance.now()-start,requests:{},ok});}
}
