import type {ElectrumCore,Header} from './electrum-core.js';
/** Public categories intentionally omit scripts, outpoints and wallet addresses. */
export class ProviderVerificationError extends Error {
 constructor(readonly category:'synchronizing'|'unavailable'|'conflict'){
  super(category==='conflict'?'Conflicting blockchain evidence — transaction blocked.':category==='unavailable'?'Waiting for a second verified provider…':'Electrum providers synchronizing — retrying…');
 }
}
export interface VerifiedRead<T>{value:T;tip:Header;identity:string}
/** Each candidate must perform its own complete cryptographic verification. A quorum
 * only establishes agreement; it never substitutes for verification. Sessions are
 * sequential because ElectrumCore pins mutable transport state to one connection. */
export async function verifiedProviders<T>(p:ElectrumCore,peers:string[],read:(peer:string)=>Promise<VerifiedRead<T>>,options:{attempts?:number;sleep?:(ms:number)=>Promise<void>;onProgress?:(message:string)=>void}={}):Promise<T>{
 let category:'synchronizing'|'unavailable'='unavailable';
 const unresolved=p.unresolvedChainPeers??=new Set<string>();
 const conflict=async(hosts:string[])=>{for(const host of hosts)unresolved.add(host);try{await p.persistChainConflict?.([...unresolved]);}catch{/* Failure to persist never authorizes a conflicting snapshot. */}throw new ProviderVerificationError('conflict');};
 for(let attempt=0;attempt<(options.attempts??3);attempt++){
  const good:{peer:string;result:VerifiedRead<T>}[]=[],tips=new Map<string,Header>(),observations:{peer:string;result:{tip:Header}}[]=[];let movement=false;
  for(const peer of peers)try{const result=await p.session(async()=>{const tip=await p.tip();tips.set(peer,tip);observations.push({peer,result:{tip}});return read(peer);},peer);tips.set(peer,result.tip);observations.push({peer,result:{tip:result.tip}});good.push({peer,result});}catch(error){
   if(/synchronizing|[Tt]ip changed|normal blockchain extension/.test(String(error)))movement=true;
   if(/[Rr]eorganization/.test(String(error)))await conflict([...tips.keys()]);
   // Explicit evidence of conflict must never be masked by two other providers.
   if(/double.spend|[Cc]onflicting unconfirmed|[Cc]ompeting v3 spends|[Rr]eorganization|[Hh]eader chain mismatch|[Ss]ource.output proof mismatch|[Ii]nvalid unconfirmed ancestor/.test(String(error)))throw new ProviderVerificationError('conflict');
  }
  {
   let unavailableLink=false,ordinaryLag=false;
   // Even a third, lagging source is checked for a conflicting chain. Prove an
   // ordinary extension using linked headers before allowing its exclusion.
   const sorted=observations.sort((a,b)=>a.result.tip.height-b.result.tip.height);
   for(let i=1;i<sorted.length;i++){
    const low=sorted[i-1]!,high=sorted[i]!;
    if(low.result.tip.hash===high.result.tip.hash)continue;
    if(low.result.tip.height===high.result.tip.height)await conflict([...tips.keys()]);
    ordinaryLag=true;
    try{await p.session(()=>p.verifyHeaderChain(low.result.tip.height,high.result.tip,new Map([[low.result.tip.height,low.result.tip.hash]])),high.peer);}catch(error){if(/mismatch|[Ii]nconsistent/.test(String(error)))await conflict([...tips.keys()]);unavailableLink=true;}
   }
   // Equal identity includes tip and all action-relevant state. All inputs have
   // been re-read on both selected sources during this attempt.
   if(unresolved.size){if(unavailableLink||[...unresolved].some(peer=>!tips.has(peer)))throw new ProviderVerificationError('conflict');await p.persistChainConflict?.([]);unresolved.clear();}
   const latest=Math.max(...[...tips.values()].map(t=>t.height));
   const current=good.filter(x=>x.result.tip.height===latest);
   // A verified pending transition seen by even one source cannot be voted away.
   // Wait for propagation; never authorize an older snapshot when a newer tip is known.
   const differentCurrent=new Set(current.map(x=>x.result.identity)).size>1;
   for(const candidate of unavailableLink||differentCurrent||movement?[]:current){if(current.filter(x=>x.result.identity===candidate.result.identity).length>=2)return candidate.result.value;}
   category=good.length>=2||movement||ordinaryLag?'synchronizing':'unavailable';
  }
  if(attempt+1<(options.attempts??3)){const message=new ProviderVerificationError(category).message;p.onVerificationProgress?.(message);options.onProgress?.(message);}
  if(attempt+1<(options.attempts??3))await (options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))))((attempt+1)*500);
 }
 throw new ProviderVerificationError(category);
}
