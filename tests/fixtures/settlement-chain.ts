/** Captured chipnet funding/genesis/registrations; synthetic subsequent headers and confirmations.
 * No PoW or public confirmations are claimed by this deterministic protocol fixture. */
import captured from './settlement-chipnet.json' with {type:'json'};
import { ElectrumCore, decodeRawTransaction, headerHash, hash256, scriptHash, type ElectrumRequest } from '../../src/electrum-core.js';
import { sourceOutput, validateKeeperTransaction } from '../../src/keeper-core.js';
import { utxo } from '../../src/arena-core.js';
export const settlementConfig=captured.configs[0]!;
export class SettlementChain {
  headers=new Map<number,string>();
  transactions=new Map<string,ReturnType<typeof decodeRawTransaction>>();
  confirmed=new Map<string,number>();
  proofs=new Map<string,any>();
  pending=new Set<string>();
  broadcasts:string[]=[];
  transactionValidator=validateKeeperTransaction;
  permittedFees=new Set([10000n]);
  fail=false;disagree=false;rejectNext=false;loseAcknowledgement=false;
  height=0;time=Math.floor(Date.now()/1000)-1200;
  requestLog:{endpoint:string;method:string}[]=[];
  constructor() {
    for(const [key,value] of Object.entries(captured.responses)) {
      const [method,a,b]=JSON.parse(key);
      if(method==='blockchain.block.header')this.headers.set(a,value as string);
      if(method==='blockchain.block.headers')for(let i=0;i<(value as any).count;i++)this.headers.set(a+i,(value as any).hex.slice(i*160,(i+1)*160));
      if(method==='blockchain.transaction.get')this.transactions.set(a,decodeRawTransaction(value as string,a));
      if(method==='blockchain.transaction.get_merkle'){this.confirmed.set(a,b);this.proofs.set(a,value);}
    }
    this.height=this.confirmed.get(settlementConfig.genesis)!;
    for(const [id,height] of [...this.confirmed])if(height>this.height)this.confirmed.delete(id);
    for(let i=0;i<11;i++)this.mine([]);
  }
  provider() {
    const endpoints=['wss://first.fixture:50004','wss://second.fixture:50004'];
    // Synthetic pre-upgrade chain: exercise real VM/lineage without a public broadcast.
    // The production chipnet transaction freeze is tested directly against ElectrumCore.
    class SyntheticProvider extends ElectrumCore {override async sendRawTransaction(raw:string):Promise<string>{return this.request('blockchain.transaction.broadcast',raw);}}
    return new SyntheticProvider(endpoint=>({connect:async()=>{if(this.fail)throw Error('Fixture disconnected');},close:()=>{},request:async(method,...params)=>{
      this.requestLog.push({endpoint,method});
      const result=await this.request(method,...params);
      if(this.disagree&&endpoint===endpoints[1]&&method==='blockchain.scripthash.get_history')return [];
      return result;
    }}),{endpoints,allowBroadcast:true});
  }
  clock() {
    const times=Array.from({length:11},(_,i)=>Buffer.from(this.headers.get(this.height-10+i)!,'hex').readUInt32LE(68)).sort((a,b)=>a-b);
    return {height:this.height,mtp:times[5]!};
  }
  mine(ids=[...this.pending]) {
    const merkle=ids.length?this.root(ids):Buffer.alloc(32),previous=headerHash(this.headers.get(this.height)!);
    this.height++;this.time+=60;
    const header=Buffer.alloc(80);header.writeUInt32LE(0x20000000,0);Buffer.from(previous,'hex').reverse().copy(header,4);merkle.copy(header,36);header.writeUInt32LE(this.time,68);header.writeUInt32LE(0x1d00ffff,72);
    this.headers.set(this.height,header.toString('hex'));
    for(let n=0;n<ids.length;n++){const id=ids[n]!;this.confirmed.set(id,this.height);this.pending.delete(id);this.proofs.set(id,{block_height:this.height,pos:n,merkle:this.branch(ids,n)});}
  }
  private root(ids:string[]) {let level:Buffer[]=ids.map(id=>Buffer.from(id,'hex').reverse());while(level.length>1){if(level.length%2)level.push(level.at(-1)!);const next:Buffer[]=[];for(let i=0;i<level.length;i+=2)next.push(hash256(Buffer.concat([level[i]!,level[i+1]!])));level=next;}return level[0]!;}
  private branch(ids:string[],position:number) {const branch:string[]=[];let level:Buffer[]=ids.map(id=>Buffer.from(id,'hex').reverse());while(level.length>1){if(level.length%2)level.push(level.at(-1)!);branch.push(Buffer.from(level[position^1]!).reverse().toString('hex'));position=Math.floor(position/2);const next:Buffer[]=[];for(let i=0;i<level.length;i+=2)next.push(hash256(Buffer.concat([level[i]!,level[i+1]!])));level=next;}return branch;}
  reorgLastBlock() {for(const [id,height]of this.confirmed)if(height===this.height)this.confirmed.delete(id);this.headers.delete(this.height);this.height--;this.time-=60;}
  private active() {return [...this.transactions.values()].filter(tx=>this.confirmed.has(tx.txid)||this.pending.has(tx.txid));}
  private spends(tx:ReturnType<typeof decodeRawTransaction>) {return tx.vin.map(input=>`${input.txid}:${input.vout}`);}
  request:ElectrumRequest=async(method,...params)=>{
    if(this.fail)throw Error('Fixture disconnected');
    if(method==='server.version')return ['Settlement fixture','1.5'];
    if(method==='blockchain.headers.subscribe')return {height:this.height,hex:this.headers.get(this.height)};
    if(method==='blockchain.block.header')return this.headers.get(Number(params[0]));
    if(method==='blockchain.block.headers')return {count:params[1],hex:Array.from({length:Number(params[1])},(_,i)=>this.headers.get(Number(params[0])+i)).join('')};
    if(method==='blockchain.transaction.get'){const tx=this.transactions.get(String(params[0]));if(!tx)throw Error('Transaction unavailable');return tx.hex;}
    if(method==='blockchain.transaction.get_merkle'){const id=String(params[0]);if(this.confirmed.get(id)!==params[1])throw Error('No active confirmation');return this.proofs.get(id);}
    if(method==='blockchain.scripthash.get_history')return this.active().filter(tx=>tx.vout.some(o=>scriptHash(o.scriptPubKey.hex)===params[0])||tx.vin.some(i=>{const prev=this.transactions.get(i.txid)?.vout[i.vout];return prev&&scriptHash(prev.scriptPubKey.hex)===params[0];})).map(tx=>({tx_hash:tx.txid,height:this.confirmed.get(tx.txid)??0})).sort((a,b)=>a.tx_hash.localeCompare(b.tx_hash));
    if(method==='blockchain.scripthash.listunspent') {
      if(params[1]!=='include_tokens')throw Error('Token-inclusive UTXOs required');
      const active=this.active(),spent=new Set(active.flatMap(tx=>this.spends(tx)));
      return active.flatMap(tx=>tx.vout.filter(o=>scriptHash(o.scriptPubKey.hex)===params[0]&&!spent.has(`${tx.txid}:${o.n}`)).map(o=>({tx_hash:tx.txid,tx_pos:o.n,height:this.confirmed.get(tx.txid)??0,value:Number(o.satoshis),...(o.tokenData?{token_data:o.tokenData}:{})})));
    }
    if(method==='blockchain.transaction.broadcast') {
      const tx=decodeRawTransaction(String(params[0]));this.broadcasts.push(tx.txid);
      if(this.rejectNext){this.rejectNext=false;throw Error('txn-mempool-conflict');}
      if(this.confirmed.has(tx.txid)||this.pending.has(tx.txid))return tx.txid;
      const spent=new Set(this.active().flatMap(tx=>this.spends(tx)));
      if(this.spends(tx).some(outpoint=>spent.has(outpoint)))throw Error('txn-mempool-conflict');
      const sources=tx.vin.map(i=>{const prev=this.transactions.get(i.txid);if(!prev)throw Error('Missing input');return sourceOutput(utxo(prev,i.vout));});
      const fee=sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.vout.reduce((n,o)=>n+BigInt(o.satoshis),0n);
      if(!this.permittedFees.has(fee))throw Error('Unexpected fixture fee');
      this.transactionValidator(tx.hex,sources,this.clock(),fee);
      this.transactions.set(tx.txid,tx);this.pending.add(tx.txid);
      if(this.loseAcknowledgement){this.loseAcknowledgement=false;throw Error('Connection lost after submission');}
      return tx.txid;
    }
    throw Error('Unsupported fixture method '+method);
  };
}
