import {tickContext} from './consensus-clock.js';
import { mempoolProjection } from './mempool.js';
import { Buffer } from './bytes.js';
import type { NetworkProvider } from 'cashscript';
import { ElectrumCore, type HistoryEntry } from './electrum-core.js';
import { verifyRegistryGenesis } from './genesis-core.js';
import { type VaultConfig, contracts, contract, transitionWitness, termsFor, json } from './arena-core.js';
import { hashState, nextState, remainingCommitment, STATE_SIZE } from './registry.js';
export interface Allocation { id: string; terms: string; output: any; withdrawal?: string }
export interface VaultState { config: VaultConfig; category: string; witness: string; transaction: any; history: { txid: string; height: number; action: number; slot: number; period: number; witness: string }[]; allocations: Allocation[] }
export interface Block { height: number; hash: string; parent?: string; mtp: number; nextBlockTicks?:number; transactions: any[] }
export interface Checkpoint { network?: string; version: number; configs: VaultConfig[]; blocks: Block[]; vaults?: VaultState[]; updatedAt?: string }
export async function projectVaults(configs: VaultConfig[], blocks: Block[], read: (id: string) => Promise<any>, provider: NetworkProvider, allowUnconfirmed = false) {
    const vaults: VaultState[] = [];
    const admitted = new Map<string, Awaited<ReturnType<typeof contracts>>>();
    for (const block of blocks) for (const tx of block.transactions) {
      for (const config of configs.filter(c => c.genesis === tx.txid)) {
        const verified = await verifyRegistryGenesis(config.genesis, config, read, provider, allowUnconfirmed);
        const cs = await contracts(config, verified.category, provider);
        admitted.set(verified.category, cs);
        vaults.push({ config, category: verified.category, witness: Buffer.alloc(STATE_SIZE).toString('hex'), transaction: tx, history: [], allocations: [] });
      }
      for (const vault of vaults) {
        for (const allocation of vault.allocations) if (tx.vin.some((i: any) => `${i.txid}:${i.vout}` === allocation.id)) {
          if (allocation.withdrawal && allocation.withdrawal !== tx.txid) throw Error('Duplicate allocation spend');
          allocation.withdrawal = tx.txid;
        }
        if (tx.txid === vault.transaction.txid) continue;
        if (!tx.vin.some((i: any) => i.txid === vault.transaction.txid && i.vout === 0)) continue;
        if (tx.vin[0].txid !== vault.transaction.txid || tx.vin[0].vout !== 0 || tx.vin[1]?.txid !== vault.transaction.txid || tx.vin[1]?.vout !== 1) throw Error('Broken canonical lineage');
        const w = transitionWitness(tx.vin[0].scriptSig.hex);
        if (w.state.toString('hex') !== vault.witness || w.action < 0 || w.action > 5 || w.slot > 15) throw Error('State preimage mismatch');
        const next = nextState(w.state, w.action, w.slot, w.record), cs = admitted.get(vault.category)!;
        const state = tx.vout[0], pool = tx.vout[1], amount = remainingCommitment(next);
        if (state.scriptPubKey.hex !== cs.registry.lockingBytecode || state.tokenData?.category !== vault.category
          || state.tokenData.nft?.capability !== 'mutable' || state.tokenData.nft.commitment !== hashState(next)
          || pool.scriptPubKey.hex !== cs.pool.lockingBytecode || BigInt(pool.tokenData?.amount ?? 0) !== amount
          || (amount > 0n && pool.tokenData?.category !== vault.config.stakingCategory)) throw Error('Indexed covenant output mismatch');
        if (w.action === 3) {
          const terms = termsFor(vault.config, vault.category, w.state, w.slot);
          const allocation = await contract('StakeAllocation', [terms], provider);
          if (tx.vout[3]?.scriptPubKey.hex !== allocation.lockingBytecode) throw Error('Allocation terms mismatch');
          vault.allocations.push({ id: `${tx.txid}:3`, terms: terms.toString('hex'), output: tx.vout[3] });
        }
        vault.history.push({ txid: tx.txid, height: block.height, action: w.action, slot: w.slot, period: w.state.readUInt32LE(0), witness: w.state.toString('hex') });
        vault.witness = next.toString('hex'); vault.transaction = tx;
      }
    }
    return vaults;
  }
export interface CheckpointStore { load(): Promise<Checkpoint | undefined>; save(value: Checkpoint): Promise<void> }
/** Portable confirmed-state reader. Transport and atomic persistence are injected. */
export class ElectrumIndexer {
  blocks: Block[] = [];
  histories = new Map<string, HistoryEntry[]>();
  vaults: VaultState[] = [];
  displayVaults?: VaultState[];
  displayError = '';
  health = { connected: false, error: '', updatedAt: '', stale: true, syncing: false, provider: 'electrum', endpoint: '', unconfirmed: [] as string[], phase: 'Connecting', transactions: 0 };
  protected busy = false;
  onChange?: () => void;
  constructor(readonly configs: VaultConfig[], readonly electrum?: ElectrumCore, readonly store?: CheckpointStore, readonly minDisplayConfirmations = 1) {
    if (!Number.isSafeInteger(minDisplayConfirmations) || minDisplayConfirmations < 0) throw Error('Invalid minimum display confirmations');
  }
  get tip() { return this.blocks.at(-1); }
  async load() {
    const saved = await this.store?.load();
    if (!saved) return;
    if (saved.network !== 'chipnet' || saved.version !== 2 || json(saved.configs) !== json(this.configs) || !Array.isArray(saved.blocks)) throw Error('Checkpoint configuration mismatch');
    this.blocks = saved.blocks;
    // Saved projection is available to the UI as explicitly stale data, never used for replay.
  }
  async sync() {
    if (this.busy) throw Error('Index sync already running');
    if (!this.electrum) throw Error('Electrum provider required');
    this.busy = true; this.health.syncing = true; this.health.phase = 'Connecting'; this.health.transactions = 0; this.onChange?.();
    try {
      await this.electrum.session(() => this.replay());
      // Settlement always reads this.vaults, which remains confirmed-only.
      try {
        const scripts = [...this.histories.keys()];
        const primary = await this.electrum.session(() => mempoolProjection(this.electrum!, this.configs, this.blocks, scripts, this.minDisplayConfirmations));
        const endpoint = this.electrum.endpoint;
        const peers = this.electrum.endpoints.filter(e => e !== endpoint && new URL(e).hostname !== new URL(endpoint).hostname);
        if (primary.pending.length && !peers.length) throw Error('Pending display requires two independent Electrum hosts');
        let corroborated = primary.pending.length === 0;
        const unavailable: string[] = [];
        for (const peer of primary.pending.length ? peers : []) {
          try { await this.electrum.session(async () => {
            if ((await this.electrum!.tip()).hash !== primary.tip) throw Error('Electrum providers disagree on tip');
            for (const [script, entries] of primary.histories) {
              const normalize = (h: HistoryEntry[]) => json([...h].map(e => ({...e, height: Math.max(0,e.height)})).sort((a,b) => a.tx_hash.localeCompare(b.tx_hash)));
              if (normalize(await this.electrum!.history(script)) !== normalize(entries)) throw Error('Electrum providers disagree on mempool history');
            }
            if ((await this.electrum!.tip()).hash !== primary.tip) throw Error('Peer tip changed during mempool verification');
          }, peer); corroborated = true; break; }
          catch (error) {
            if (/providers disagree|Peer tip changed/.test(String(error))) throw error;
            unavailable.push(String(error));
          }
        }
        if (!corroborated) throw Error('Pending display could not be reconciled: '+unavailable.join('; '));
        this.displayVaults = primary.vaults; this.displayError = '';
      } catch (error) {
        // Withhold pending entries immediately on disagreement/outage. Confirmed
        // state remains usable only under its existing verification rules.
        this.displayVaults = await this.electrum.session(() => projectVaults(this.configs, this.blocks.map(b => ({...b, transactions:b.transactions.filter(tx => this.tip!.height-tx.height+1 >= Math.max(1,this.minDisplayConfirmations))})), id => this.electrum!.transactionStatus(id), this.electrum!));
        this.displayError = String(error);
      }
    }
    catch (error) { this.displayVaults = this.vaults.filter(v => this.tip!.height-v.transaction.height+1 >= Math.max(1,this.minDisplayConfirmations)); this.displayError = String(error); this.health = { ...this.health, connected: false, stale: true, phase: 'Disconnected', error: String(error) }; throw error; }
    finally { this.busy = false; this.health.syncing = false; this.onChange?.(); }
  }
  async verifyUtxos() { await this.sync(); }
  /** Re-read histories and proofs on each pass. Durable state is never trusted after restart/reorg. */
  private async replay() {
    const p = this.electrum!, tip = await p.tip();
    const transactions = new Map<string, any>(), histories = new Map<string, HistoryEntry[]>();
    const unconfirmed = new Set<string>();
    const readHistory = async (script: string) => {
      if (histories.has(script)) return;
      const entries = await p.history(script); histories.set(script, entries);
      for (const h of entries) {
        if (h.height <= 0) { unconfirmed.add(h.tx_hash); continue; }
        if (h.height > tip.height) throw Error('History ahead of tip');
        const existing = transactions.get(h.tx_hash);
        if (existing && existing.height !== h.height) throw Error('Inconsistent history height');
        if (!existing) {
          if (transactions.size >= p.maxTransactions) throw Error('Transaction history exceeds configured safety limit');
          transactions.set(h.tx_hash, await p.transaction(h.tx_hash, h.height));
          this.health.transactions = transactions.size;
          if (transactions.size % 10 === 0) this.onChange?.();
        }
      }
    };
    this.health.phase = 'Reading vault history'; this.onChange?.();
    for (const config of this.configs) {
      let genesis;
      try { genesis = await p.transactionStatus(config.genesis); }
      catch (error) { if (/no such.*transaction|not found|unknown transaction|Transaction status unavailable/i.test(String(error))) continue; throw error; }
      if (!genesis.confirmations) {
        const category = genesis.vin[0]?.txid;
        if (!category) throw Error('Malformed genesis');
        const cs = await contracts(config, category, p);
        await readHistory(cs.registry.lockingBytecode); await readHistory(cs.pool.lockingBytecode);
        continue;
      }
      transactions.set(genesis.txid, genesis);
      const category = genesis.vin[0]?.txid;
      if (!category) throw Error('Malformed genesis');
      const cs = await contracts(config, category, p);
      await readHistory(cs.registry.lockingBytecode);
      await readHistory(cs.pool.lockingBytecode);
      if (!histories.get(cs.registry.lockingBytecode)!.some(h => h.tx_hash === config.genesis && h.height === genesis.height)) throw Error('Genesis absent from registry history');
    }
    const read = async (id: string) => transactions.get(id) ?? p.transactionStatus(id);
    const build = async (): Promise<Block[]> => {
      // Topological order is authoritative within a block (BCH uses CTOR, not registration order).
      const ordered: any[] = [], visiting = new Set<string>(), done = new Set<string>();
      for (const root of [...transactions.values()].sort((a,b) => a.height-b.height)) {
        const stack: { tx: any; finish: boolean }[] = [{ tx: root, finish: false }];
        while (stack.length) {
          const { tx, finish } = stack.pop()!;
          if (done.has(tx.txid)) continue;
          if (finish) { visiting.delete(tx.txid); done.add(tx.txid); ordered.push(tx); continue; }
          if (visiting.has(tx.txid)) throw Error('Cyclic transaction graph');
          visiting.add(tx.txid); stack.push({ tx, finish: true });
          for (const input of [...tx.vin].reverse()) {
            const parent = transactions.get(input.txid);
            if (parent) {
              if (parent.height > tx.height) throw Error('Parent confirmed after child');
              if (!done.has(parent.txid)) stack.push({ tx: parent, finish: false });
            }
          }
        }
      }
      const blocks: Block[] = [];
      for (const tx of ordered) {
        let block = blocks.at(-1);
        if (!block || block.height !== tx.height) {
          const h = await p.header(tx.height);
          block = { height: h.height, hash: h.hash, parent: h.parent, mtp: 0, transactions: [] }; blocks.push(block);
        }
        if (tx.blockhash !== block.hash) throw Error('Chain changed during transaction discovery');
        block.transactions.push(tx);
      }
      return blocks;
    };
    this.health.phase = 'Reconstructing confirmed state'; this.onChange?.();
    let candidate = await build(), vaults = await projectVaults(this.configs, candidate, read, p);
    for (const vault of vaults) for (const allocation of vault.allocations) await readHistory(allocation.output.scriptPubKey.hex);
    candidate = await build(); vaults = await projectVaults(this.configs, candidate, read, p);
    // All spends must be present, and no confirmed output can have two spenders.
    const spends = new Map<string, string>();
    for (const tx of transactions.values()) for (const input of tx.vin) {
      const id = `${input.txid}:${input.vout}`;
      if (spends.has(id) && spends.get(id) !== tx.txid) throw Error('Conflicting confirmed spends');
      spends.set(id, tx.txid);
    }
    for (const vault of vaults) {
      for (const n of [0,1]) if (spends.has(`${vault.transaction.txid}:${n}`)) throw Error('Canonical lineage incomplete');
      for (const output of [vault.transaction.vout[0], vault.transaction.vout[1], ...vault.allocations.filter(a => !a.withdrawal).map(a => a.output)]) {
        const rows = await p.getUtxosForLockingBytecode(output.scriptPubKey.hex);
        const txid = output === vault.transaction.vout[0] || output === vault.transaction.vout[1] ? vault.transaction.txid : vault.allocations.find(a => a.output === output)!.id.split(':')[0];
        if (!rows.some(u => u.txid === txid && u.vout === output.n)) {
          let pendingSpend = false;
          for (const id of unconfirmed) {
            const tx = await p.transaction(id);
            if (tx.vin.some((input: any) => input.txid === txid && input.vout === output.n)) pendingSpend = true;
          }
          if (!pendingSpend) throw Error('Canonical UTXO unavailable; confirmed snapshot withheld');
        }
      }
    }
    this.health.phase = 'Checking chain consistency'; this.onChange?.();
    // Recheck all queried histories and headers to reject mixed snapshots and mid-pass reorganizations.
    for (const [script, history] of histories) if (json(await p.history(script)) !== json(history)) throw Error('History changed during indexing');
    for (const block of candidate) if ((await p.header(block.height)).hash !== block.hash) throw Error('Chain changed during indexing');
    await p.verifyHeaderChain(candidate[0]?.height ?? tip.height, tip, new Map(candidate.map(b => [b.height, b.hash])));
    const mtp = await p.medianTime(tip.height, tip.hash),ticks=await tickContext(p,tip);
    if ((await p.tip()).hash !== tip.hash) throw Error('Tip changed during indexing');
    if (candidate.at(-1)?.height === tip.height) Object.assign(candidate.at(-1)!,{mtp,...ticks});
    else candidate.push({ height: tip.height, hash: tip.hash, parent: tip.parent, mtp,...ticks, transactions: [] });
    const updatedAt = new Date().toISOString();
    await this.store?.save({ version: 2, network: 'chipnet', configs: this.configs, blocks: candidate, vaults, updatedAt });
    this.blocks = candidate; this.vaults = vaults; this.histories = histories;
    this.health = { ...this.health, connected: true, stale: false, error: '', updatedAt, endpoint: p.endpoint, phase: 'Synchronized', unconfirmed: [...unconfirmed] };
  }
}
