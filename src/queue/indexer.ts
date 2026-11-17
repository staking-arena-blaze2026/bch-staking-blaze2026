import {binToHex,decodeTransaction,hexToBin,hashTransaction} from '@bitauth/libauth';
import type {SpendableUtxo} from 'cashscript';
import {arena,root as rootContract,gate,genesis,readNode,readState,source,verify,type Context} from './protocol.js';
import {CARRIER,ZERO,compare,emptyLink,sameLink,type Offer} from './model.js';
export interface Anchor {genesis:string;creator:string}
/** Sources must be fetched and authenticated against the selected chain, not
 * accepted from a vault announcement. VM validation alone cannot prove ancestry. */
export function authenticateGenesis(c:Context,anchor:Anchor,raw:string,sources:SpendableUtxo[]){
 if(hashTransaction(hexToBin(raw))!==anchor.genesis)throw Error('Genesis transaction hash mismatch');
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error(tx);
 if(tx.inputs.length!==sources.length||sources.some((u,i)=>u.txid!==binToHex(tx.inputs[i]!.outpointTransactionHash)||u.vout!==tx.inputs[i]!.outpointIndex))throw Error('Genesis source identity mismatch');
 if(sources[0]?.txid!==c.identity.vault||sources[1]?.txid!==c.identity.queue||sources[0]?.vout!==0||sources[1]?.vout!==0||sources[0]?.lockingBytecode!==genesis(c.p,hexToBin(anchor.creator),c.provider).lockingBytecode)throw Error('Noncanonical genesis');
 verify({raw,sources});
 if(sources.slice(2).some(u=>u.token?.nft)||tx.outputs.slice(2).some(o=>o.token?.nft))throw Error('Noncanonical genesis asset NFT');
 // The genesis covenant constrains all outputs, supplies and capabilities.
 return {context:c,anchor};
}
export interface Snapshot {vault:SpendableUtxo;root:SpendableUtxo;nodes:Map<string,{offer:Offer;utxo:SpendableUtxo}>;ordered:Offer[]}
/** A UTXO-set traversal for display/routing, never a claim witness. Every live
 * queue NFT is accounted for; duplicates, orphans and stale score caches fail. */
export function snapshot(c:Context,utxos:SpendableUtxo[]):Snapshot{
 const states=utxos.filter(u=>u.token?.category===c.identity.vault),roots=utxos.filter(u=>u.token?.category===c.identity.queue&&u.token.nft?.commitment==='00');
 if(states.length!==1||roots.length!==1)throw Error('Vault/root uniqueness failure');
 const vault=states[0]!,root=roots[0]!,s=readState(c,vault),nodes:Snapshot['nodes']=new Map();
 if(root.lockingBytecode!==rootContract(c).lockingBytecode||root.satoshis!==CARRIER||root.token?.amount!==0n||root.token.nft?.capability!=='minting')throw Error('Invalid root authority');
 for(const u of utxos){if(u===root||u===vault)continue;if(u.token?.category!==c.identity.queue)continue;const o=readNode(c,u);if(nodes.has(o.id))throw Error('Duplicate queue membership');nodes.set(o.id,{offer:o,utxo:u});}
 const ordered:Offer[]=[],seen=new Set<string>();let link=s.head;
 while(link.id!==ZERO){const node=nodes.get(link.id);if(!node||seen.has(link.id)||!sameLink(link,node.offer))throw Error('Malformed, cyclic or stale link');const o=node.offer;seen.add(o.id);ordered.push(o);if(o.next.id!==ZERO&&compare(o,o.next)<0)throw Error('Queue ordering failure');link=o.next;}
 if(!sameLink(link,emptyLink())||seen.size!==nodes.size)throw Error('Orphan node or malformed tail');
 return {vault,root,nodes,ordered};
}
export function insertionPoint(s:Snapshot,terms:Pick<Offer,'stake'|'duration'|'reward'>){let previous:Offer|undefined;for(const o of s.ordered){if(compare(terms,o)>0)break;previous=o;}return previous?{controller:s.nodes.get(previous.id)!.utxo}:{controller:s.vault,authority:s.ordered.length?s.nodes.get(s.ordered[0]!.id)!.utxo:s.root};}
export function cancellationPoint(s:Snapshot,id:string){const position=s.ordered.findIndex(o=>o.id===id);if(position<0)throw Error('Offer no longer live');return {controller:position===0?s.vault:s.nodes.get(s.ordered[position-1]!.id)!.utxo,node:s.nodes.get(id)!.utxo};}
export function validateEscrow(c:Context,o:Offer,u:SpendableUtxo){if(c.p.stakingCategory===ZERO||u.lockingBytecode!==gate(c,o.id).lockingBytecode||u.satoshis!==CARRIER||u.token?.category!==c.p.stakingCategory||u.token.amount!==o.stake||u.token.nft)throw Error('Escrow mismatch');}
