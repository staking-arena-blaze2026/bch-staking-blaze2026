import {payload} from './discovery.js';
import {discoveryScript,DISCOVERY_CARRIER} from '../v3/discovery.js';
import {v3Network} from '../v3/network.js';
import {encodeDataPush,binToHex,decodeTransaction,hexToBin,hashTransaction} from '@bitauth/libauth';
import type {SpendableUtxo} from 'cashscript';
import {arena,root as rootContract,gate,ownerScript,readNode,readState,verify,type Context} from './protocol.js';
import {CARRIER,ZERO,compare,emptyLink,sameLink,type Offer} from './model.js';
export interface Anchor {genesis:string;creator:string}
/** Sources must be fetched and authenticated against the selected chain, not
 * accepted from a vault announcement. VM validation alone cannot prove ancestry. */
export function authenticateGenesis(c:Context,anchor:Anchor,raw:string,sources:SpendableUtxo[]){
 if(hashTransaction(hexToBin(raw))!==anchor.genesis)throw Error('Genesis transaction hash mismatch');
 const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error(tx);
 if(tx.version!==2||tx.inputs.length<2||tx.inputs.length>16||!/^(02|03)[a-f0-9]{64}$/.test(anchor.creator))throw Error('Noncanonical genesis transaction');
 if(tx.inputs.length!==sources.length||sources.some((u,i)=>u.txid!==binToHex(tx.inputs[i]!.outpointTransactionHash)||u.vout!==tx.inputs[i]!.outpointIndex))throw Error('Genesis source identity mismatch');
 if(sources[0]?.txid!==c.identity.vault||sources[1]?.txid!==c.identity.queue||sources[0]?.vout!==0||sources[1]?.vout!==0||sources[0]?.token||sources[1]?.token)throw Error('Noncanonical genesis');
 // Authentication establishes the unique non-minting vault origin. Queue
 // minting authority is confined to its distinct category and covenant roles.
 arena(c);verify({raw,sources});
 const outputs=tx.outputs.map((o,vout)=>({txid:anchor.genesis,vout,satoshis:o.valueSatoshis,lockingBytecode:binToHex(o.lockingBytecode),...(o.token?{token:{category:binToHex(o.token.category),amount:o.token.amount,...(o.token.nft?{nft:{capability:o.token.nft.capability,commitment:binToHex(o.token.nft.commitment)}}:{})}}:{})}));
 const initial=snapshot(c,outputs.slice(0,2)),s=readState(c,initial.vault),reserve=BigInt(c.p.releases)*c.p.cap;
 if(initial.vault!==outputs[0]||initial.root!==outputs[1]||s.head.id!==ZERO||!sameLink(s.head,emptyLink())||s.reserve!==reserve)throw Error('Noncanonical initial state');
 let at=2;
 if(c.p.rewardCategory!==ZERO){const u=outputs[at++];if(!u||u.lockingBytecode!==gate(c).lockingBytecode||u.satoshis!==CARRIER||u.token?.category!==c.p.rewardCategory||u.token.amount!==reserve||u.token.nft)throw Error('Missing full reward reserve');}
 // A public listing is optional for protocol-only callers; if present it must
 // be the exact marker and canonical payload in this same transaction.
 if(outputs[at]?.lockingBytecode===discoveryScript(v3Network(c.provider))){
  if(outputs[at]!.satoshis!==DISCOVERY_CARRIER||outputs[at]!.token)throw Error('Invalid discovery carrier');at++;
  const expected='6a'+binToHex(encodeDataPush(payload({parameters:c.p,creator:anchor.creator,queue:c.identity.queue})));
  if(outputs[at]?.lockingBytecode!==expected||outputs[at]!.satoshis!==0n||outputs[at]!.token)throw Error('Invalid genesis announcement');at++;
 }
 if(outputs.length>at+2)throw Error('Unexpected genesis outputs');
 let tokenIn=0n,tokenOut=0n;
 for(const u of sources){if(u.token){if(u.token.nft||c.p.rewardCategory===ZERO||u.token.category!==c.p.rewardCategory)throw Error('Noncanonical genesis funding');tokenIn+=u.token.amount;}}
 for(const u of outputs.slice(at)){
  if(u.lockingBytecode!==binToHex(ownerScript(hexToBin(anchor.creator))))throw Error('Noncanonical genesis change');
  if(u.token){if(u.token.nft||c.p.rewardCategory===ZERO||u.token.category!==c.p.rewardCategory)throw Error('Extra genesis authority or token');tokenOut+=u.token.amount;}
 }
 if(c.p.rewardCategory!==ZERO&&tokenIn!==reserve+tokenOut)throw Error('Genesis token conservation failure');
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
