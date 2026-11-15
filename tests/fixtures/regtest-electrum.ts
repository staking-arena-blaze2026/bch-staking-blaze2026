/** Electrum protocol facade over LOCAL BCHN regtest. No public network sockets. */
import { Network } from 'cashscript';
import { ElectrumCore, decodeRawTransaction, scriptHash, hash256 } from '../../src/electrum-core.js';
import { rpc, assertRegtest } from '../../src/rpc.js';
export class RegtestElectrum extends ElectrumCore {
  override network = Network.REGTEST;
  rows = new Map<string, { tx: any; height: number }>();
  headerCache = new Map<number,string>();
  rawParents = new Map<string,any>();
  extra = new Map<string,string>();
  hidden = new Set<string>();
  disagree = false;
  unavailable = new Set<string>();
  constructor(readonly startHeight: number) {
    super(() => { throw Error('Public transport prohibited in regtest'); }, { endpoints:['mock://regtest-a','mock://regtest-b'], maxTipAgeSeconds:Number.MAX_SAFE_INTEGER });
  }
  override async session<T>(work: () => Promise<T>, endpoint=this.endpoints[0]): Promise<T> { await assertRegtest(); if(this.unavailable.has(endpoint))throw Error('Mock Electrum provider unavailable');this.endpoint=endpoint; return work(); }
  async refresh() {
    this.rows.clear();
    const tip = await rpc('getblockcount');
    for (let height=this.startHeight; height<=tip; height++) {
      const block = await rpc('getblock',[await rpc('getblockhash',[height]),2]);
      for (const tx of block.tx) this.rows.set(tx.txid,{tx:decodeRawTransaction(tx.hex,tx.txid),height});
    }
    for (const id of await rpc<string[]>('getrawmempool')) this.rows.set(id,{tx:decodeRawTransaction(await rpc('getrawtransaction',[id])),height:0});
    for (const [id,raw] of this.extra) this.rows.set(id,{tx:decodeRawTransaction(raw,id),height:0});
    for (const id of this.hidden) this.rows.delete(id);
  }
  override async transactionStatus(id:string) {
    if (this.hidden.has(id)) throw Error('Transaction status unavailable');
    if(this.extra.has(id))return {...decodeRawTransaction(this.extra.get(id)!,id),confirmations:0};
    const verbose = await rpc('getrawtransaction',[id,true]);
    if (!verbose.confirmations && !this.rows.has(id)) throw Error('Transaction status unavailable');
    const height = verbose.confirmations > 0 ? (await rpc('getblockheader',[verbose.blockhash])).height : 0;
    const tx = await this.transaction(id,height);
    return {...tx,confirmations:verbose.confirmations ?? 0};
  }
  override request = async (method:string,...params:(string|number|boolean)[]):Promise<any> => {
    if(method==='blockchain.headers.subscribe'){const height=await rpc('getblockcount');return {height,hex:await this.request('blockchain.block.header',height)};}
    if(method==='blockchain.block.header'){const height=Number(params[0]);if(!this.headerCache.has(height))this.headerCache.set(height,await rpc('getblockheader',[await rpc('getblockhash',[height]),false]));return this.headerCache.get(height);}
    if(method==='blockchain.block.headers'){const hex=[];for(let offset=0;offset<Number(params[1]);offset+=8)hex.push(...await Promise.all(Array.from({length:Math.min(8,Number(params[1])-offset)},(_,i)=>this.request('blockchain.block.header',Number(params[0])+offset+i))));return {count:params[1],hex:hex.join('')};}
    if(method==='blockchain.transaction.get')return this.extra.get(String(params[0])) ?? this.rows.get(String(params[0]))?.tx.hex ?? rpc('getrawtransaction',[params[0]]);
    if(method==='blockchain.transaction.get_merkle'){
      const block=await rpc('getblock',[await rpc('getblockhash',[params[1]]),1]);
      let position=block.tx.indexOf(params[0]);const pos=position,merkle:string[]=[];
      let level:Buffer[]=block.tx.map((id:string)=>Buffer.from(id,'hex').reverse());
      while(level.length>1){if(level.length%2)level.push(level.at(-1)!);merkle.push(Buffer.from(level[position^1]).reverse().toString('hex'));position=Math.floor(position/2);const next:Buffer[]=[];for(let i=0;i<level.length;i+=2)next.push(hash256(Buffer.concat([level[i],level[i+1]])));level=next;}
      return {block_height:params[1],pos,merkle};
    }
    if(method==='blockchain.scripthash.get_history'){
      if(this.disagree&&this.endpoint===this.endpoints[1])return [];
      const rows=[];
      for(const {tx,height} of this.rows.values()){
        let matches=tx.vout.some((o:any)=>scriptHash(o.scriptPubKey.hex)===params[0]);
        for(const input of tx.vin){if(matches)break;if(/^0+$/.test(input.txid))continue;let parent=this.rows.get(input.txid)?.tx ?? this.rawParents.get(input.txid);if(!parent){parent=decodeRawTransaction(await rpc('getrawtransaction',[input.txid]));this.rawParents.set(input.txid,parent);}matches=scriptHash(parent.vout[input.vout].scriptPubKey.hex)===params[0];}
        if(matches)rows.push({tx_hash:tx.txid,height});
      }
      return rows.sort((a,b)=>a.tx_hash.localeCompare(b.tx_hash));
    }
    if(method==='blockchain.scripthash.listunspent'){
      const rows=[];
      for(const {tx,height} of this.rows.values())for(const output of tx.vout)if(scriptHash(output.scriptPubKey.hex)===params[0]&&await rpc('gettxout',[tx.txid,output.n,true]))rows.push({tx_hash:tx.txid,tx_pos:output.n,height,value:Number(output.satoshis)});
      return rows;
    }
    throw Error('Unsupported local Electrum method '+method);
  };
}
