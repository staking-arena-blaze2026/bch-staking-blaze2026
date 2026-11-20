import { ElectrumCore, ElectrumTransportError, type ElectrumConnection, type ElectrumOptions, type ElectrumRequest } from './electrum-core.js';

/** Electrum WSS frames contain one JSON object, without TCP's newline terminator. */
export class WssConnection implements ElectrumConnection {
  private socket?: WebSocket;
  private cancelConnect?: (error: Error) => void;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly endpoint: string, readonly timeout: number) {}
  async connect() {
    const url = new URL(this.endpoint);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search) throw Error('Browser Electrum endpoint must be a credential-free WSS URL');
    this.close();
    await new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try { socket = new WebSocket(url); }
      catch { reject(new ElectrumTransportError('Electrum WSS could not open','connect')); return; }
      this.socket = socket;
      const fail = (message: string, reason: ElectrumTransportError['reason']) => {
        if (this.socket === socket) this.close(new ElectrumTransportError(message,reason));
      };
      const timer = setTimeout(() => fail('Electrum WSS connect timeout','connect timeout'), this.timeout);
      this.cancelConnect = error => { clearTimeout(timer); reject(error); };
      socket.onopen = () => {
        if (this.socket !== socket) return;
        clearTimeout(timer); this.cancelConnect = undefined; resolve();
      };
      socket.onerror = () => fail('Electrum WSS connection failed','connect');
      socket.onclose = () => fail('Electrum WSS disconnected','disconnect');
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 16*1024*1024) throw Error('Invalid or oversized Electrum WSS frame');
          const response = JSON.parse(event.data);
          if (!response || Array.isArray(response) || typeof response !== 'object') throw Error('Malformed Electrum WSS response');
          const pending = this.pending.get(response.id);
          if (!pending) return; // Header notifications and late responses do not change state.
          clearTimeout(pending.timer); this.pending.delete(response.id);
          if (response.error) pending.reject(Error(`Electrum ${JSON.stringify(response.error)}`)); else pending.resolve(response.result);
        } catch (error) { this.close(error instanceof Error ? error : Error(String(error))); }
      };
    });
  }
  request: ElectrumRequest = (method, ...params) => new Promise((resolve, reject) => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) { reject(new ElectrumTransportError('Electrum WSS is disconnected')); return; }
    const id = ++this.sequence;
    const timer = setTimeout(() => this.close(new ElectrumTransportError(`Electrum WSS timeout: ${method}`,'request timeout')), this.timeout);
    this.pending.set(id, {resolve, reject, timer});
    try { this.socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params})); }
    catch { this.close(new ElectrumTransportError('Electrum WSS could not send the request','send')); }
  });
  close(error = Error('Electrum WSS session closed')) {
    const socket = this.socket;
    this.socket = undefined;
    this.cancelConnect?.(error);
    this.cancelConnect = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!socket) return;
    socket.onopen = socket.onerror = socket.onclose = socket.onmessage = null;
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
export class BrowserElectrumProvider extends ElectrumCore {
  constructor(options: ElectrumOptions = {}) {
    super((endpoint,timeout) => new WssConnection(endpoint,timeout), options);
  }
}
