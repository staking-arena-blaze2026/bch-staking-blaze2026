import type {DappConnectionManager} from '@wizardconnect/dapp';
import {RelayMsgAction} from '@wizardconnect/core';
export class ExplicitWalletRefusal extends Error {}
/** SDK rejects promises for BOTH transport failures and authenticated wallet errors.
 * Only a matching wallet response proves refusal. Never infer it from error text.
 */
export async function signWithRefusalEvidence(manager:DappConnectionManager,request:Parameters<DappConnectionManager['signTransaction']>[0],options:Parameters<DappConnectionManager['signTransaction']>[1],retainLate?:(raw:string)=>Promise<void>){
 let sequence:number|undefined,late=false,arrived:string|undefined,retaining=false;const refused=new Set<number>();
 const recover=()=>{
  if(!late||!arrived||!retainLate||retaining)return;
  retaining=true;
  // Keep the authenticated response in memory if durable storage fails. A
  // repeated matching response can retry retention; it can never authorize.
  void retainLate(arrived).then(()=>manager.off('messagereceived',received),()=>{retaining=false;});
 };
 const sent=(message:any)=>{if(message.action===RelayMsgAction.SignTransactionRequest)sequence=message.sequence;};
 const received=(message:any)=>{
  if(message.action!==RelayMsgAction.SignTransactionResponse)return;
  if(message.error==='User rejected the transaction'&&!message.signedTransaction)refused.add(message.sequence);
  if(sequence!==undefined&&message.sequence===sequence&&typeof message.signedTransaction==='string'){arrived=message.signedTransaction;recover();}
 };
 manager.on('messagesent',sent);manager.on('messagereceived',received);
 try{const result=await manager.signTransaction(request,options);if(result.error==='User rejected the transaction'&&!result.signedTransaction)throw new ExplicitWalletRefusal('Wallet explicitly refused the signing request');return result;}
 catch(error){
  if(error instanceof ExplicitWalletRefusal||sequence!==undefined&&refused.has(sequence))throw new ExplicitWalletRefusal('Wallet explicitly refused the signing request');
  late=!!retainLate&&sequence!==undefined;recover();throw error;
 }
 finally{manager.off('messagesent',sent);if(!late)manager.off('messagereceived',received);}
}
