import { ElectrumCore, type ElectrumOptions } from './electrum-core.js';
import { TcpConnection } from './electrum-tcp.js';
export * from './electrum-core.js';
/** Node TCP/TLS adapter; the same protocol checks run in the browser WSS adapter. */
export class ElectrumProvider extends ElectrumCore {
  constructor(options: ElectrumOptions = {}) {
    super((endpoint, timeout) => new TcpConnection(endpoint, timeout), {
      ...options, endpoints: options.endpoints ?? (process.env.ARENA_ELECTRUM_ENDPOINTS ?? (options.network==='mainnet'?'ssl://bch.loping.net:50002,ssl://bch.imaginary.cash:50002':'ssl://chipnet.bch.ninja:50002,ssl://chipnet.imaginary.cash:50002')).split(','),
      timeoutMs: options.timeoutMs ?? Number(process.env.ARENA_ELECTRUM_TIMEOUT_MS ?? 10000),
    });
  }
}
