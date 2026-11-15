import type {DappConnectionManager} from '@wizardconnect/dapp';
import {RelayMsgAction} from '@wizardconnect/core';
export class ExplicitWalletRefusal extends Error {}
/** SDK rejects promises for BOTH transport failures and authenticated wallet errors.
 * Only a matching wallet response proves refusal. Never infer it from error text.
 */
export async function signWithRefusalEvidence(manager:DappConnectionManager,request:Parameters<DappConnectionManager['signTransaction']>[0],options:Parameters<DappConnectionManager['signTransaction']>[1]){
 let sequence:number|undefined;const refused=new Set<number>();
 const sent=(message:any)=>{if(message.action===RelayMsgAction.SignTransactionRequest)sequence=message.sequence;};
 const received=(message:any)=>{if(message.action===RelayMsgAction.SignTransactionResponse&&message.error==='User rejected the transaction'&&!message.signedTransaction)refused.add(message.sequence);};
 manager.on('messagesent',sent);manager.on('messagereceived',received);
 try{const result=await manager.signTransaction(request,options);if(result.error==='User rejected the transaction'&&!result.signedTransaction)throw new ExplicitWalletRefusal('Wallet explicitly refused the signing request');return result;}
 catch(error){if(error instanceof ExplicitWalletRefusal||sequence!==undefined&&refused.has(sequence))throw new ExplicitWalletRefusal('Wallet explicitly refused the signing request');throw error;}
 finally{manager.off('messagesent',sent);manager.off('messagereceived',received);}
}
