import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rpc} from '../../src/rpc.js';
/** A second isolated BCHN: exercises actual loopback P2P propagation with
 * standard policy, independently of the source node's RPC admission result. */
export async function queueRelayPeer(){
 const directory=await mkdtemp(join(tmpdir(),'staking-queue-peer-'));
 await writeFile(join(directory,'bitcoin.conf'),'regtest=1\nserver=1\nlisten=1\ndnsseed=0\ndiscover=0\nupnp=0\nnatpmp=0\nacceptnonstdtxn=0\ntxindex=1\ndbcache=32\npar=1\ntxbroadcastinterval=100\n[regtest]\nconnect=0\nbind=127.0.0.1:18470\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\nrpcport=18471\n');
 const child=spawn(process.env.BCHN_TEST_BINARY??'/home/omarchy/.local/bin/bitcoind',[`-datadir=${directory}`,'-regtest','-expire=0','-upgrade12activationheight=1'],{stdio:'ignore'}),stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 async function peer(method:string,params:unknown[]=[]):Promise<any>{const cookie=(await readFile(join(directory,'regtest/.cookie'),'utf8')).trim(),r=await fetch('http://127.0.0.1:18471',{method:'POST',headers:{authorization:'Basic '+Buffer.from(cookie).toString('base64'),'content-type':'application/json'},body:JSON.stringify({jsonrpc:'1.0',id:'queue',method,params}),signal:AbortSignal.timeout(10000)}),v=await r.json() as any;if(v.error||!r.ok)throw Error(JSON.stringify(v.error));return v.result;}
 async function until(check:()=>Promise<boolean>,label:string,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){if(child.exitCode!==null)throw Error('Relay peer exited');try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('P2P relay timeout: '+label);}
 async function close(){try{await rpc('setnetworkactive',[false]);}catch{}try{await peer('stop');}catch{child.kill('SIGTERM');}await stopped;await rm(directory,{recursive:true,force:true});}
 try{await until(async()=>await peer('getblockcount')>=0,'startup');await rpc('setnetworkactive',[true]);await rpc('addnode',['127.0.0.1:18470','onetry']);await until(async()=>await peer('getbestblockhash')===await rpc('getbestblockhash'),'initial chain sync');return {peer,until,close};}catch(e){await close();throw e;}
}
