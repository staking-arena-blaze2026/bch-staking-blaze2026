import {finalityLimit} from './consensus-clock.js';
import { createVirtualMachineBch2026, decodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import { ElectrumCore } from './electrum-core.js';
import { json, type VaultConfig } from './arena-core.js';
import { projectVaults, type Block } from './indexer-core.js';

const mempoolVm = createVirtualMachineBch2026();

/** Display-only replay. No result from this module authorizes spending or settlement. */
export async function mempoolProjection(p: ElectrumCore, configs: VaultConfig[], blocks: Block[], scripts: string[], minimum: number) {
  const tip = blocks.at(-1)!;
  const transactions = new Map<string, any>(blocks.flatMap(b => b.transactions.map(tx => [tx.txid, tx] as const)));
  const histories = new Map<string, any[]>(), pending = new Map<string, any>();
  const visible = blocks.map(b => ({ ...b, transactions: b.transactions.filter(tx => tip.height - tx.height + 1 >= minimum) }));
  const read = async (id: string) => transactions.get(id) ?? pending.get(id) ?? p.transactionStatus(id);
  if (minimum > 0) return {vaults:await projectVaults(configs,visible,read,p),pending:[] as string[],histories,tip:tip.hash};
  const visiting = new Set<string>(), ordered: any[] = [], spends = new Map<string, string>();
  const history = async (script: string) => {
    if (!histories.has(script)) histories.set(script, await p.history(script));
    return histories.get(script)!;
  };
  const load = async (id: string): Promise<any> => {
    if (transactions.has(id)) return transactions.get(id);
    if (pending.has(id)) return pending.get(id);
    if (visiting.has(id)) throw Error('Cyclic mempool dependencies');
    if (transactions.size + pending.size + visiting.size >= p.maxTransactions) throw Error('Mempool dependency limit exceeded');
    visiting.add(id);
    const tx = await p.transactionStatus(id);
    if (tx.confirmations > 0) {
      if (tx.height > tip.height) throw Error('Dependency ahead of indexed tip');
      transactions.set(id, tx); visiting.delete(id); return tx;
    }
    const decoded = decodeTransaction(hexToBin(tx.hex));
    if (typeof decoded === 'string') throw Error('Invalid mempool transaction');
    const sources: Output[] = [];
    for (const input of tx.vin) {
      const parent = await load(input.txid), output = parent.vout[input.vout];
      if (!output) throw Error('Missing mempool source output');
      // A raw transaction alone is not evidence that an input is available. Every
      // provider must report this exact spender and no competing spender.
      const entries = await history(output.scriptPubKey.hex);
      if (!entries.some(h => h.tx_hash === id && h.height <= 0)) throw Error('Mempool spender absent from source history');
      for (const entry of entries) {
        if (entry.tx_hash === id || entry.tx_hash === parent.txid) continue;
        const other = await p.transaction(entry.tx_hash, entry.height);
        if (other.vin.some((i: any) => i.txid === input.txid && i.vout === input.vout)) throw Error('Conflicting or replaced mempool transaction');
      }
      const key = `${input.txid}:${input.vout}`;
      if (spends.has(key) && spends.get(key) !== id) throw Error('Conflicting mempool spends');
      spends.set(key, id);
      const source = decodeTransaction(hexToBin(parent.hex));
      if (typeof source === 'string') throw Error('Invalid mempool parent');
      sources.push(source.outputs[input.vout]!);
    }
    if (decoded.locktime && decoded.inputs.some(i => i.sequenceNumber !== 0xffffffff)
      && decoded.locktime >= (decoded.locktime < 500000000 ? finalityLimit(tip) : tip.mtp)) throw Error('Non-final mempool transaction');
    const valid = mempoolVm.verify({ transaction: decoded, sourceOutputs: sources });
    if (valid !== true) throw Error(`Mempool covenant validation failed: ${String(valid)}`);
    visiting.delete(id); pending.set(id, tx); ordered.push(tx); return tx;
  };
  for (const script of scripts) for (const h of await history(script)) if (h.height <= 0) await load(h.tx_hash);
  // Re-read all histories, including dependency scripts, before publishing.
  for (const [script, entries] of histories) if (json(await p.history(script)) !== json(entries)) throw Error('Mempool changed during indexing');
  if ((await p.tip()).hash !== tip.hash) throw Error('Tip changed during mempool indexing');
  if (minimum === 0 && ordered.length) visible.push({ height: 0, hash: '', mtp: tip.mtp, transactions: ordered });
  const vaults = await projectVaults(configs, visible, read, p, minimum === 0);
  return { vaults, pending: [...pending.keys()], histories, tip: tip.hash };
}
