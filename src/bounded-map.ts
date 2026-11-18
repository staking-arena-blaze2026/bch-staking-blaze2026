/** Drain every in-flight read before a pinned transport is closed or retried. */
export async function boundedMap<T,R>(items:readonly T[],limit:number,read:(item:T)=>Promise<R>):Promise<R[]> {
 const result:R[]=[];
 for(let start=0;start<items.length;start+=limit){
  const settled=await Promise.allSettled(items.slice(start,start+limit).map(read));
  const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  for(const row of settled)if(row.status==='fulfilled')result.push(row.value);
 }
 return result;
}
