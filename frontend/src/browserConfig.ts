import {excludedChipnetProvider} from '../../src/chipnet-policy';
import {localVaultRecords} from './vaultCatalog';
import defaults from '../../config/electrum-chipnet.json';
import type { VaultConfig } from '../../src/arena-core';
export type IndexerSource = 'api' | 'electrum' | 'off';
export interface BrowserIndexerConfig {
  network: 'chipnet'; vaults: VaultConfig[]; endpoints: string[]; timeoutMs: number; pollMs: number;
  minDisplayConfirmations?: number; maxHistoryEntries: number; maxTransactions: number; maxRawBytes: number; tabId: string;
}
export function indexerSource(base: string | null, mode = import.meta.env.VITE_INDEXER_MODE): IndexerSource {
  if (mode && !['api','electrum','off'].includes(mode)) throw Error('VITE_INDEXER_MODE must be api, electrum or off');
  return (mode as IndexerSource | undefined) ?? (base ? 'api' : 'electrum');
}
export function browserConfig(env: Record<string, string | undefined> = import.meta.env): BrowserIndexerConfig {
  if (env.VITE_ARENA_NETWORK && env.VITE_ARENA_NETWORK !== 'chipnet') throw Error('Browser indexing is chipnet-only');
  const endpoints = (env.VITE_ELECTRUM_ENDPOINTS ?? 'wss://chipnet.imaginary.cash:50004,wss://chipnet.bch.ninja:50004').split(',').map(s=>s.trim());
  if(endpoints.some(excludedChipnetProvider))throw Error('OptnLabs excluded: incompatible chipnet consensus branch');
  if (!endpoints.length || endpoints.length > 4) throw Error('Configure one to four chipnet WSS endpoints');
  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search) throw Error('Browser Electrum endpoints must be credential-free WSS URLs');
  }
  const configured: VaultConfig[] = env.VITE_ARENA_VAULTS ? JSON.parse(env.VITE_ARENA_VAULTS) : defaults.vaults;
  const vaults: VaultConfig[] = [...configured,...localVaultRecords().map(v=>v.config).filter(v=>!configured.some(c=>c.genesis===v.genesis))];
  if (!Array.isArray(vaults) || vaults.length > 32 || vaults.some(v=>!v || !/^[a-f0-9]{64}$/i.test(v.genesis) || !/^[a-f0-9]{64}$/i.test(v.stakingCategory)
    || !Number.isInteger(v.epoch) || v.epoch < 500000000 || !Number.isInteger(v.periodSeconds) || v.periodSeconds < 1
    || !Number.isInteger(v.periods) || v.periods < 1 || v.periods > 16 || !Number.isInteger(v.cap) || v.cap < 1000 || v.cap > 1000000
    || v.epoch + (2*v.periods-1)*v.periodSeconds > 2147483647) || new Set(vaults.map(v=>v.genesis)).size !== vaults.length) throw Error('Invalid configured chipnet genesis vaults');
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid ${name}`);
    return value;
  };
  let tabId: string;
  try { tabId = sessionStorage.getItem('arena-electrum-tab') ?? crypto.randomUUID(); sessionStorage.setItem('arena-electrum-tab',tabId); }
  catch { tabId=crypto.randomUUID(); }
  return { network:'chipnet', vaults, endpoints, tabId, minDisplayConfirmations:integer('VITE_MIN_DISPLAY_CONFIRMATIONS',0,0,1000000),
    timeoutMs:integer('VITE_ELECTRUM_TIMEOUT_MS',10000,100,60000), pollMs:integer('VITE_ELECTRUM_POLL_MS',15000,1000,60000),
    maxHistoryEntries:integer('VITE_ELECTRUM_MAX_HISTORY',50000,1,100000), maxTransactions:integer('VITE_ELECTRUM_MAX_TRANSACTIONS',20000,1,50000), maxRawBytes:integer('VITE_ELECTRUM_MAX_RAW_BYTES',16777216,1024,67108864) };
}
