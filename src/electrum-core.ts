import { Buffer, hash256, sha256Bytes } from './bytes.js';
export { hash256 } from './bytes.js';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hashTransaction, hexToBin } from '@bitauth/libauth';
import { Network, type NetworkProvider, type SpendableUtxo } from 'cashscript';
export interface ElectrumConnection { connect(): Promise<void>; request: ElectrumRequest; close(): void }
export type ConnectionFactory = (endpoint: string, timeoutMs: number) => ElectrumConnection;
export const scriptHash = (script: string) => sha256Bytes(Buffer.from(script, 'hex')).reverse().toString('hex');
export const headerHash = (hex: string) => hash256(Buffer.from(hex, 'hex')).reverse().toString('hex');
export interface Header { height: number; hex: string; hash: string; parent: string; time: number; merkle: string }
/** Shown while a normal block arrival is re-read. Not a successful verification by itself. */
export const BLOCKCHAIN_REFRESH = 'Electrum providers synchronizing — retrying…';
export class ChainExtension extends Error {
  constructor() { super(BLOCKCHAIN_REFRESH); this.name = 'ChainExtension'; }
}
export interface HistoryEntry { tx_hash: string; height: number }
export interface ElectrumOptions { network?: 'chipnet' | 'regtest' | 'mainnet'; endpoints?: string[]; timeoutMs?: number; maxTipAgeSeconds?: number; maxHistoryEntries?: number; maxTransactions?: number; maxRawBytes?: number; allowBroadcast?: boolean }
export type ElectrumRequest = (method: string, ...params: (string | number | boolean)[]) => Promise<any>;
const isHash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function decodeRawTransaction(raw: string, expected?: string) {
  if (!/^(?:[a-f0-9]{2})+$/i.test(raw)) throw Error('Invalid raw transaction hex');
  const bytes = hexToBin(raw), tx = decodeTransaction(bytes), txid = hashTransaction(bytes);
  if (typeof tx === 'string' || (expected && expected !== txid)) throw Error('Invalid raw transaction or transaction ID mismatch');
  return { txid, hex: raw, vin: tx.inputs.map(i => ({ txid: binToHex(i.outpointTransactionHash), vout: i.outpointIndex, scriptSig: { hex: binToHex(i.unlockingBytecode) } })),
    vout: tx.outputs.map((o, n) => ({ n, satoshis: o.valueSatoshis.toString(), value: Number(o.valueSatoshis) / 1e8, scriptPubKey: { hex: binToHex(o.lockingBytecode) },
      ...(o.token ? { tokenData: { category: binToHex(o.token.category), amount: o.token.amount.toString(), ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } } : {}) })) };
}
/** Read adapter: raw bytes are authoritative for amounts/tokens, not verbose JSON numbers.
 * Sessions pin a server; failover retries the whole read snapshot. No automatic broadcasting.
 */
export class ElectrumCore implements NetworkProvider {
  network: Network = Network.CHIPNET;
  readonly endpoints: string[];
  readonly timeoutMs: number;
  readonly maxTipAgeSeconds: number;
  readonly maxHistoryEntries: number;
  readonly maxTransactions: number;
  readonly maxRawBytes: number;
  private rawBytes = 0;
  endpoint = '';
  private activeChainSession=false;
  readonly allowBroadcast: boolean;
  request: ElectrumRequest = async () => { throw Error('Electrum operation requires a session'); };
  constructor(readonly connectionFactory: ConnectionFactory, options: ElectrumOptions = {}) {
    this.allowBroadcast=options.allowBroadcast===true;
    if (!['mainnet','chipnet','regtest'].includes(options.network??'chipnet')) throw Error('Unsupported Electrum network');
    if(options.network==='regtest')this.network=Network.REGTEST;
    if(options.network==='mainnet')this.network=Network.MAINNET;
    this.endpoints = options.endpoints ?? (this.network===Network.MAINNET?['wss://bch.loping.net:50004','wss://bch.imaginary.cash:50004']:['wss://chipnet.imaginary.cash:50004', 'wss://electrum-chipnet.optnlabs.com', 'wss://chipnet.bch.ninja:50004']);
    if(this.network===Network.REGTEST&&this.endpoints.some(e=>!['localhost','127.0.0.1','[::1]'].includes(new URL(e).hostname)))throw Error('Regtest Electrum requires local endpoints');
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxTipAgeSeconds = options.maxTipAgeSeconds ?? 21600;
    this.maxHistoryEntries = options.maxHistoryEntries ?? 50000;
    this.maxTransactions = options.maxTransactions ?? 20000;
    this.maxRawBytes = options.maxRawBytes ?? 16*1024*1024;
    if (!this.endpoints.length || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100) throw Error('Invalid Electrum configuration');
    for (const limit of [this.maxTransactions,this.maxHistoryEntries,this.maxRawBytes,this.maxTipAgeSeconds]) if (!Number.isSafeInteger(limit) || limit<1) throw Error('Invalid Electrum safety limit');
  }
  /** Public verification category only; never includes wallet scripts or outpoints. */
  onVerificationProgress?:(message:string)=>void;
  unresolvedChainPeers=new Set<string>();
  persistChainConflict?:(peers:string[])=>Promise<void>;
  private rawCache?: Map<string,string>;
  // Only immutable, txid-validated bytes persist. Histories, proofs, UTXOs and tips
  // are always live. Peer scope preserves independent provider observations.
  private immutableRaw=new Map<string,string>();
  private immutableBytes=0;
  private queue: Promise<unknown> = Promise.resolve();
  session<T>(work: () => Promise<T>, endpoint?: string): Promise<T> {
    const result = this.queue.then(() => this.runSession(work,endpoint));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async runSession<T>(work: () => Promise<T>, pinnedEndpoint?: string): Promise<T> {
    const errors: string[] = [];
    if(pinnedEndpoint && !this.endpoints.includes(pinnedEndpoint))throw Error('Unconfigured Electrum endpoint');
    for (const endpoint of pinnedEndpoint?[pinnedEndpoint]:this.endpoints) {
      const connection = this.connectionFactory(endpoint, this.timeoutMs);
      try {
        this.rawCache = new Map(); this.rawBytes = 0;
        await connection.connect(); this.endpoint = endpoint; this.request = connection.request;
        const version = await this.request('server.version', 'Staking Arena', '1.5.0');
        if (!Array.isArray(version) || !/^1\.(?:[5-9]|[1-9][0-9])(?:\.|$)/.test(version[1])) throw Error('Electrum Cash protocol 1.5.0 required: ' + JSON.stringify(version));
        if(this.network===Network.REGTEST){if((await this.header(0)).hash!=='0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206')throw Error('Electrum regtest identity mismatch');}
        else if(this.network===Network.MAINNET){if((await this.header(0)).hash!=='000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'||(await this.header(792773)).hash!=='000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8')throw Error('Electrum mainnet identity mismatch');}
        else if ((await this.header(0)).hash !== '000000001dd410c49a788668ce26751718cc797474d3152a5fc073dd44fd9f7b'
          || (await this.header(121957)).hash !== '0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78') throw Error('Electrum chipnet identity mismatch');
        this.activeChainSession=true;
        return await work();
      } catch (e) { errors.push(`${endpoint}: ${String(e)}`); }
      finally { this.activeChainSession=false; connection.close(); this.rawCache = undefined; this.request = async () => { throw Error('Electrum session closed'); }; }
    }
    throw Error(errors.join('; '));
  }
  async header(height: number): Promise<Header> {
    if (!Number.isSafeInteger(height) || height < 0) throw Error('Invalid header height');
    const hex = await this.request('blockchain.block.header', height);
    if (typeof hex !== 'string' || !/^[0-9a-f]{160}$/.test(hex)) throw Error('Malformed Electrum header');
    const b = Buffer.from(hex, 'hex');
    return { height, hex, hash: headerHash(hex), parent: Buffer.from(b.subarray(4,36)).reverse().toString('hex'), merkle: Buffer.from(b.subarray(36,68)).reverse().toString('hex'), time: b.readUInt32LE(68) };
  }
  async tip() {
    const result = await this.request('blockchain.headers.subscribe');
    const header = await this.header(result.height);
    if (header.hex !== result.hex || Date.now()/1000 - header.time > this.maxTipAgeSeconds || header.time > Date.now()/1000 + 7200) throw Error('Stale or inconsistent Electrum tip');
    return header;
  }
  /** A taller chain that still contains the previous tip is a normal extension. A replaced tip is not. */
  async classifyTipChange(previous: { height: number; hash: string }): Promise<'same' | 'extension' | 'reorg'> {
    const current = await this.tip();
    if (current.hash === previous.hash && current.height === previous.height) return 'same';
    if (current.height > previous.height) {
      try {
        const at = await this.header(previous.height);
        if (at.hash !== previous.hash) return 'reorg';
        await this.verifyHeaderChain(previous.height, current, new Map([[previous.height, previous.hash]]));
        return 'extension';
      } catch(error) { if(/Header chain mismatch/.test(String(error)))return 'reorg';throw error; }
    }
    return 'reorg';
  }
  /** Link every relevant proof header to the selected tip, including gaps without vault activity. */
  async verifyHeaderChain(firstHeight: number, tip: Header, expected: Map<number, string>) {
    let previous: string | undefined;
    for (let start = firstHeight; start <= tip.height; start += 2016) {
      const count = Math.min(2016, tip.height-start+1);
      const result = await this.request('blockchain.block.headers', start, count);
      if (result.count !== count || typeof result.hex !== 'string' || !new RegExp(`^[0-9a-f]{${count*160}}$`).test(result.hex)) throw Error('Incomplete header range');
      for (let i = 0; i < count; i++) {
        const hex = result.hex.slice(i*160, (i+1)*160), bytes = Buffer.from(hex, 'hex'), hash = headerHash(hex);
        const parent = Buffer.from(bytes.subarray(4,36)).reverse().toString('hex'), height = start+i;
        if ((previous && parent !== previous) || (expected.has(height) && expected.get(height) !== hash) || (height === tip.height && hash !== tip.hash)) throw Error('Header chain mismatch');
        previous = hash;
      }
    }
  }
  async medianTime(height: number, expectedTipHash?: string) {
    const headers: Header[] = [];
    const fetched=await Promise.all(Array.from({length:Math.min(11,height+1)},(_,i)=>this.header(Math.max(0,height-10)+i)));
    for (const h of fetched) {
      if (headers.length && h.parent !== headers.at(-1)!.hash) throw Error('Inconsistent MTP headers');
      headers.push(h);
    }
    if (expectedTipHash && headers.at(-1)!.hash !== expectedTipHash) throw Error('MTP tip mismatch');
    return headers.map(h => h.time).sort((a,b) => a-b)[Math.floor(headers.length/2)]!;
  }
  async history(script: string): Promise<HistoryEntry[]> {
    if (!/^(?:[a-f0-9]{2})*$/i.test(script)) throw Error('Invalid locking script');
    const history = await this.request('blockchain.scripthash.get_history', scriptHash(script));
    if (Array.isArray(history) && history.length > this.maxHistoryEntries) throw Error('Electrum history exceeds the configured limit; snapshot withheld');
    if (!Array.isArray(history) || history.some(h => !isHash(h.tx_hash) || (!Number.isSafeInteger(h.height) || h.height < -1)) || new Set(history.map(h => h.tx_hash)).size !== history.length) throw Error('Malformed Electrum history');
    return history;
  }
  async getRawTransaction(txid: string): Promise<string> {
    if (!isHash(txid)) throw Error('Invalid transaction ID');
    const cached = this.rawCache?.get(txid); if (cached) return cached;
    if (this.rawCache && this.rawCache.size >= this.maxTransactions) throw Error('Raw transaction limit exceeded');
    const identity=this.network+':'+this.endpoint+':'+txid;
    const raw = this.immutableRaw.get(identity) ?? await this.request('blockchain.transaction.get', txid, false);
    if (typeof raw !== 'string' || raw.length/2 + this.rawBytes > this.maxRawBytes) throw Error('Raw transaction byte limit exceeded; snapshot withheld');
    decodeRawTransaction(raw, txid);
    if(!this.immutableRaw.has(identity)&&raw.length/2<=this.maxRawBytes){
      while(this.immutableRaw.size>=512||this.immutableBytes+raw.length/2>this.maxRawBytes){const first=this.immutableRaw.keys().next().value;if(first===undefined)break;this.immutableBytes-=this.immutableRaw.get(first)!.length/2;this.immutableRaw.delete(first);}
      this.immutableRaw.set(identity,raw);this.immutableBytes+=raw.length/2;
    }
    if(this.rawCache) {if(!this.rawCache.has(txid)&&this.rawCache.size>=this.maxTransactions)throw Error('Raw transaction limit exceeded');this.rawBytes+=raw.length/2;this.rawCache.set(txid,raw);}
    return raw;
  }
  async transaction(txid: string, height?: number): Promise<any> {
    const tx = decodeRawTransaction(await this.getRawTransaction(txid), txid);
    if (height === undefined || height <= 0) return { ...tx, confirmations: 0 };
    const proof = await this.request('blockchain.transaction.get_merkle', txid, height), header = await this.header(height);
    if (proof.block_height !== height || !Number.isSafeInteger(proof.pos) || proof.pos < 0 || !Array.isArray(proof.merkle) || proof.merkle.length > 32 || proof.merkle.some((s: any) => !isHash(s))) throw Error('Invalid transaction proof');
    let hash: Buffer = Buffer.from(txid, 'hex').reverse();
    let position = proof.pos;
    for (const sibling of proof.merkle) {
      const other = Buffer.from(sibling, 'hex').reverse();
      hash = hash256(Buffer.concat(position % 2 ? [other, hash] : [hash, other])); position = Math.floor(position/2);
    }
    if (position !== 0 || Buffer.from(hash).reverse().toString('hex') !== header.merkle) throw Error('Transaction Merkle proof mismatch');
    return { ...tx, confirmations: 1, blockhash: header.hash, height };
  }
  async transactionStatus(txid: string) {
    const tx = await this.transaction(txid);
    // A raw transaction lookup does not prove confirmation. Locate it through one of its output scripts.
    if (!tx.vout.length) throw Error('Transaction has no outputs');
    const entry = (await this.history(tx.vout[0].scriptPubKey.hex)).find(h => h.tx_hash === txid);
    if (!entry) throw Error('Transaction status unavailable');
    const tip = await this.tip();
    if (entry.height > tip.height) throw Error('Transaction confirmation ahead of tip');
    const confirmed = await this.transaction(txid, entry.height);
    if (entry.height > 0) await this.verifyHeaderChain(entry.height, tip, new Map([[entry.height, confirmed.blockhash]]));
    const moved = await this.classifyTipChange(tip);
    if(moved==='extension')throw new ChainExtension();
    if(moved==='reorg')throw Error('Reorganization during transaction lookup');
    return { ...confirmed, confirmations: entry.height > 0 ? tip.height - entry.height + 1 : 0 };
  }
  async getBlockHeight() { return (await this.tip()).height; }
  async getUtxos(address: string) {
    const result = cashAddressToLockingBytecode(address);
    if (typeof result === 'string' || result.prefix !== (this.network===Network.MAINNET?'bitcoincash':this.network===Network.REGTEST?'bchreg':'bchtest')) throw Error('Address network mismatch');
    return this.getUtxosForLockingBytecode(result.bytecode);
  }
  async getUtxosForLockingBytecode(script: string | Uint8Array): Promise<SpendableUtxo[]> {
    const hex = typeof script === 'string' ? script : binToHex(script);
    if (!/^(?:[a-f0-9]{2})*$/i.test(hex)) throw Error('Invalid locking script');
    const rows = await this.request('blockchain.scripthash.listunspent', scriptHash(hex), 'include_tokens');
    if (!Array.isArray(rows) || rows.length > this.maxHistoryEntries) throw Error('Malformed or oversized Electrum UTXOs');
    const outputs: SpendableUtxo[] = [], transactions=new Map<string,Promise<any>>();
    for (const row of rows) {
      if (!isHash(row.tx_hash) || !Number.isSafeInteger(row.tx_pos) || row.tx_pos < 0 || !Number.isSafeInteger(row.height)) throw Error('Malformed UTXO outpoint');
      const identity=row.tx_hash+':'+row.height;if(!transactions.has(identity))transactions.set(identity,this.transaction(row.tx_hash,row.height));
      const tx = await transactions.get(identity)!, o = tx.vout[row.tx_pos];
      if (!o || o.scriptPubKey.hex !== hex || !Number.isSafeInteger(row.value) || BigInt(row.value) !== BigInt(o.satoshis)) throw Error('Electrum UTXO mismatch');
      outputs.push({ txid: tx.txid, vout: row.tx_pos, satoshis: BigInt(o.satoshis), lockingBytecode: hex, ...({height:row.height} as object),
        ...(o.tokenData ? { token: { category: o.tokenData.category, amount: BigInt(o.tokenData.amount), ...(o.tokenData.nft ? { nft: o.tokenData.nft } : {}) } } : {}) });
    }
    return outputs;
  }
  async sendRawTransaction(raw: string): Promise<string> {
    if(this.network===Network.CHIPNET)throw Error('Chipnet temporarily unavailable for transactions: consensus upgrade verification required');
    if(!this.allowBroadcast)throw Error('Electrum broadcasting disabled');
    if(!this.activeChainSession || (this.network!==Network.MAINNET&&this.network!==Network.REGTEST))throw Error('Broadcast requires a verified active '+(this.network===Network.REGTEST?'regtest':'mainnet')+' session');
    const tx=decodeRawTransaction(raw),result=await this.request('blockchain.transaction.broadcast',raw);
    if(result!==tx.txid)throw Error('Electrum broadcast response does not match transaction ID; acceptance is uncertain');
    return result;
  }
}
