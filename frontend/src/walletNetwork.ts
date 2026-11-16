import { decodeHdPublicKey } from '@bitauth/libauth';
import type { Envelope } from './model';

export type BchNetwork = 'mainnet' | 'chipnet' | 'testnet4' | 'regtest';
export const NETWORK_NAMES: Record<BchNetwork, string> = { mainnet: 'Mainnet', chipnet: 'Chipnet', testnet4: 'Testnet4', regtest: 'Regtest' };
export interface NetworkRequirement { network: BchNetwork; genesisHash: string }
export const REGTEST_NETWORK: NetworkRequirement = Object.freeze({ network: 'regtest', genesisHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206' });
export const MAINNET_NETWORK: NetworkRequirement = Object.freeze({network:'mainnet',genesisHash:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'});
export const CHIPNET_NETWORK: NetworkRequirement = Object.freeze({ network: 'chipnet', genesisHash: '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b' });
// Optional, application-specific declaration, NOT a standard WizardConnect field.
// Current Cashonize sessions omit this; testnet key versions alone never authorize a chain.
export const NETWORK_EXTENSION = 'staking-arena/network-v1';
export interface PublicPath { name: string; xpub: string }
export interface WalletNetwork {
  network: BchNetwork | 'testnet' | 'unknown' | 'unsupported';
  source: 'declaration' | 'key-family' | 'missing' | 'invalid';
  label: string;
  genesisHash?: string;
}
const unknown = (invalid = false): WalletNetwork => ({ network: 'unknown', source: invalid ? 'invalid' : 'missing', label: invalid ? 'Invalid or conflicting network information' : 'Unknown — wallet network not declared' });
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function detectWalletNetwork(paths: readonly PublicPath[], extensions?: unknown): WalletNetwork {
  const standard = paths.filter(path => ['receive', 'change', 'defi'].includes(path.name));
  if (!standard.some(path => path.name === 'receive')) return unknown();
  const families = new Set<string>();
  for (const path of standard) {
    // Errors and unrecognized declarations are never echoed: they may contain credentials.
    const decoded = decodeHdPublicKey(path.xpub);
    if (typeof decoded === 'string') return unknown(true);
    families.add(decoded.network);
  }
  if (families.size !== 1 || new Set(standard.map(path => path.name)).size !== standard.length) return unknown(true);
  const family = [...families][0];
  const extension = object(extensions)?.[NETWORK_EXTENSION];
  if (extension !== undefined) {
    const declaration = object(extension);
    if (!declaration || typeof declaration.network !== 'string') return unknown(true);
    if (!Object.hasOwn(NETWORK_NAMES, declaration.network)) return { network: 'unsupported', source: 'invalid', label: 'Unsupported wallet network' };
    const network = declaration.network as BchNetwork;
    if ((network === 'mainnet' ? 'mainnet' : 'testnet') !== family) return unknown(true);
    if (typeof declaration.genesisHash !== 'string' || !/^[a-f0-9]{64}$/i.test(declaration.genesisHash)) return unknown(true);
    return { network, source: 'declaration', label: `${NETWORK_NAMES[network]} (wallet-declared)`, genesisHash: declaration.genesisHash.toLowerCase() };
  }
  return family === 'mainnet'
    ? { network: 'mainnet', source: 'key-family', label: 'Mainnet key family — chain not declared' }
    : { network: 'testnet', source: 'key-family', label: 'Chipnet / testnet key family — exact chain unknown' };
}

/** Vaults inherit the validated API envelope's chain, never their genesis transaction ID. */
export function requiredNetworkForVault(data: Envelope | undefined, category: string): NetworkRequirement | null {
  return data?.vaults.some(vault => vault.category === category) ? (data.chain === 'chipnet' ? CHIPNET_NETWORK : REGTEST_NETWORK) : null;
}

export interface Compatibility { matches: boolean; reason: string }
export function networkCompatibility(wallet: WalletNetwork, required: NetworkRequirement | null, connected: boolean): Compatibility {
  if (!connected) return { matches: false, reason: 'Wallet network is unconfirmed while disconnected or reconnecting. Staking transactions are unavailable.' };
  if (!required) return { matches: false, reason: 'The selected vault’s required network is unavailable. Staking transactions are unavailable.' };
  const target = NETWORK_NAMES[required.network];
  if (wallet.network === 'unsupported') return { matches: false, reason: `This wallet network is unsupported. The vault requires ${target}. Staking transactions are unavailable; you can keep viewing.` };
  if (wallet.source === 'invalid') return { matches: false, reason: `Wallet network information is invalid or conflicting. The vault requires ${target}. Staking transactions are unavailable; you can keep viewing.` };
  if (wallet.network === 'unknown' || wallet.network === 'testnet') return { matches: false, reason: `The wallet has not declared an exact supported blockchain network. The vault requires ${target}. Staking transactions are unavailable; you can keep viewing.` };
  if (wallet.network !== required.network) return { matches: false, reason: `Network mismatch: wallet uses ${NETWORK_NAMES[wallet.network]}, while the vault requires ${target}. Staking transactions are unavailable; you can keep viewing.` };
  if(required.network==='mainnet'&&wallet.source==='key-family')return {matches:true,reason:'Mainnet wallet key family. Every spend requires live BCH input verification and explicit wallet approval.'};
  if (wallet.source !== 'declaration' || wallet.genesisHash !== required.genesisHash.toLowerCase()) return { matches: false, reason: `The wallet’s chain identity does not confirm the required ${target} network. Staking transactions are unavailable; you can keep viewing.` };
  return { matches: true, reason: `Wallet declaration matches ${target}. Each transaction still requires source-output verification on the selected chain.` };
}

/** Live state only: persisted SDK paths never constitute a fresh network handshake. */
export class WalletNetworkSession {
  private live = false;
  private authorizationRevision = 0;
  get revision() { return this.authorizationRevision; }
  private extensions: unknown;
  private acceptedPaths = '';
  constructor(private readonly readPaths: () => PublicPath[]) {}
  accept(extensions?: unknown) {
    if (!this.live || this.acceptedPaths !== JSON.stringify(this.readPaths()) || JSON.stringify(this.extensions) !== JSON.stringify(extensions)) this.authorizationRevision++;
    this.extensions = extensions;
    this.acceptedPaths = JSON.stringify(this.readPaths());
    this.live = true;
  }
  invalidate() { if (this.live) this.authorizationRevision++; this.live = false; this.extensions = undefined; this.acceptedPaths = ''; }
  read() {
    const paths = this.readPaths();
    const connected = this.live && JSON.stringify(paths) === this.acceptedPaths;
    return { connected, network: connected ? detectWalletNetwork(paths, this.extensions) : unknown() };
  }
}

/** Conservative declaration-only compatibility boundary retained for reference callers.
 * Live chipnet transaction authorization uses assertChipnetTransactionSession below.
 * Future implementations must retain this live check directly before signing AND broadcasting,
 * including after asynchronous construction or wallet approval. No UI/cached boolean authorizes it.
 */
export function createStakingTransactionBoundary(session: WalletNetworkSession, required: () => NetworkRequirement | null) {
  function check() {
    const current = session.read();
    return networkCompatibility(current.network, required(), current.connected);
  }
  function blocked(): never {
    const compatibility = check(); // Re-read session paths and selected vault at the point of use.
    if (!compatibility.matches) throw new Error(compatibility.reason);
    throw new Error('Transaction signing and submission are not enabled.');
  }
  return { check, signTransaction: blocked, submitTransaction: blocked };
}

/** hdwalletv1 does not attest the wallet's exact test network. Authorize only a
 * transaction whose sources the chipnet backend has just resolved; never infer chain from tpub. */
export function assertChipnetTransactionSession(session: WalletNetworkSession, target: NetworkRequirement | null) {
  const current = session.read();
  if (!current.connected || target?.network !== 'chipnet' || target.genesisHash !== CHIPNET_NETWORK.genesisHash) throw Error('A live chipnet wallet session is required');
  const n = current.network;
  if (!['testnet', 'chipnet'].includes(n.network) || n.source === 'invalid') throw Error('Mainnet, unknown and incompatible wallets cannot sign chipnet transactions');
  if (n.source === 'declaration' && (n.network !== 'chipnet' || n.genesisHash !== CHIPNET_NETWORK.genesisHash)) throw Error('Wallet declares a different chain');
}

/** Exact live identity plus freshly proved inputs authorize the selected network only. */
export function assertTransactionSession(session:WalletNetworkSession,target:NetworkRequirement|null) {
 if(target?.network==='chipnet')return assertChipnetTransactionSession(session,target);
 const current=session.read(),n=current.network;
 if(!current.connected||target?.network!=='mainnet'||target.genesisHash!==MAINNET_NETWORK.genesisHash)throw Error('A live mainnet wallet session is required');
 if(n.network!=='mainnet'||n.source==='invalid')throw Error('A compatible mainnet wallet is required');
 if(n.source==='declaration'&&n.genesisHash!==target.genesisHash)throw Error('Wallet declares a different chain');
}
