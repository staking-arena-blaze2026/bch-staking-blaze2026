import {fetchPublicIndex} from './publicIndexTransport';
import {parseCandidates,stringify,type Candidate} from '../../src/v3/public-index';
import type {V3Network} from '../../src/v3/network';
export interface PublicPage {vaults:Candidate[];pages:string[];updatedAt:string|null;revision:string;total:number;}
/** Fixed same-origin files only; an index cannot redirect a browser or provide state. */
export async function loadPublicPage(network:V3Network,path='index.json',signal?:AbortSignal):Promise<PublicPage>{
 if(!['mainnet','chipnet','regtest'].includes(network)||!(/^(index\.json|pages\/[a-f0-9]{64}\.json)$/.test(path)))throw Error('Invalid public index path');
 const data=await fetchPublicIndex(network,path,signal),pages=data.pages??[];
 return {vaults:parseCandidates(data.vaults),pages,updatedAt:data.updatedAt??null,revision:data.revision??'',total:data.total??0};
}
export function retainedCandidates(network:V3Network):Candidate[]{try{return parseCandidates(JSON.parse(localStorage.getItem(`arena-public-index-v1-${network}`)??'[]'));}catch{return [];}}
export function retainCandidates(network:V3Network,rows:Candidate[]){try{localStorage.setItem(`arena-public-index-v1-${network}`,stringify(rows.slice(0,20)));}catch{/* Optional display hints. */}}
