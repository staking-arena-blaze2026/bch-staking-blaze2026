import type {WalletRequestCheck} from './walletRequest';
import { rememberTransaction } from './TransactionStatus';
import { stringify } from '@bitauth/libauth';
import { createContext, useContext } from 'react';
import { apiBaseUrl } from './api';
export interface WalletTransactions {
  browser?:boolean;
  v3Availability?():{available:boolean;reason?:string};
  /** Pairing is a restoration hint, never signing authorization. */
  pairing?():{paired:boolean;live:boolean;identity:string;network:string;generation?:number};
  /** Saved public branches for watch-only discovery on the selected network. */
  publicPaths?():readonly import('./walletNetwork').PublicPath[]|undefined;
  restore?():void;
  v3?(intent:Record<string,unknown>,requestCheck?:()=>void):Promise<any>;
  queue?(intent:Record<string,unknown>,requestCheck?:WalletRequestCheck):Promise<any>;
  v2?(intent:Record<string,unknown>):Promise<any>;
  inventory?(limit?:number):Promise<import('../../src/electrum-wallet').WalletInventory>;
  operations?():Promise<import('../../src/browser-wallet').WalletOperation[]>;
  inspect?(id:string):Promise<import('../../src/browser-wallet').WalletOperation>;
  importVault?(config:import('../../src/arena-core').VaultConfig):Promise<{config:import('../../src/arena-core').VaultConfig;category:string}>;
  close?():void;
  publicKey(): string;
  execute(intent: Record<string,unknown>): Promise<{txid:string;status:string;operation?:import('../../src/browser-wallet').WalletOperation}>;
}
export const WalletTransactionsContext = createContext<WalletTransactions|null>(null);
export const useWalletTransactions = () => useContext(WalletTransactionsContext);
export async function transactionApi(endpoint: string, data: unknown): Promise<any> {
  const base = apiBaseUrl();
  if (!base) throw Error('Chipnet transaction backend is unavailable');
  const response = await fetch(`${base}/transactions/${endpoint}`, { method:'POST',headers:{'content-type':'application/json','x-arena-network':'chipnet'},body:JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { const error=result.error??'Chipnet transaction failed';window.dispatchEvent(new CustomEvent('arena-transaction-error',{detail:error}));throw Error(error); }
  if(result.txid)rememberTransaction(result.txid);
  return result;
}

/** The installed WizardConnect relay uses JSON.stringify without native-type conversion. */
export function wizardWireTransaction<T>(request: T): T {
  return JSON.parse(stringify(request)) as T;
}
