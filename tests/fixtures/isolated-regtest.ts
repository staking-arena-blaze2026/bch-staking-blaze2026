import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rpc} from '../../src/rpc.js';
/** A real-clock regression must not inherit a different test's advanced MTP. */
export async function isolatedRegtest<T>(work:(control:{restartWithoutMempool:()=>Promise<void>})=>Promise<T>,rpcPort=18448):Promise<T>{
 if(process.env.ARENA_NETWORK!=='regtest')throw Error('Isolated tests require ARENA_NETWORK=regtest');const directory=await mkdtemp(join(tmpdir(),'staking-real-clock-'));
 const names=['BCH_RPC_URL','BCH_RPC_COOKIE','BCH_RPC_WALLET'] as const,original=names.map(n=>process.env[n]);
 await writeFile(join(directory,'bitcoin.conf'),`regtest=1\nserver=1\nlisten=0\ndnsseed=0\ndiscover=0\nupnp=0\nnatpmp=0\npar=1\ndbcache=32\nmaxmempool=16\ntxindex=1\nfallbackfee=0.00001\nacceptnonstdtxn=0\ntxbroadcastinterval=100\n[regtest]\nconnect=0\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\nrpcport=${rpcPort}\nport=${rpcPort+1}\n`);
 let child:ReturnType<typeof spawn>,stopped:Promise<void>;
 const start=()=>{child=spawn(process.env.BCHN_TEST_BINARY??'/home/omarchy/.local/bin/bitcoind',[`-datadir=${directory}`,'-regtest','-persistmempool=0'],{stdio:'ignore'});stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));};start();
 process.env.BCH_RPC_URL=`http://127.0.0.1:${rpcPort}/`;process.env.BCH_RPC_COOKIE=join(directory,'regtest/.cookie');process.env.BCH_RPC_WALLET='dev';
 const readyNode=async()=>{
  let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Isolated BCHN exited');try{await rpc('getblockchaininfo');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!ready)throw Error('Isolated BCHN startup timeout');
 };
 try{
  await readyNode();
  await rpc('createwallet',['dev']);await rpc('setnetworkactive',[false]);await rpc('generatetoaddress',[101,await rpc('getnewaddress')]);
  return await work({restartWithoutMempool:async()=>{await rpc('stop');await stopped;start();await readyNode();try{await rpc('loadwallet',['dev']);}catch(e){if(!String(e).includes('already loaded'))throw e;}await rpc('setnetworkactive',[false]);}});
 }finally{
  try{await rpc('stop');}catch{child!.kill('SIGTERM');}await stopped!;
  for(const [i,n]of names.entries())if(original[i]===undefined)delete process.env[n];else process.env[n]=original[i];
  await rm(directory,{recursive:true,force:true});
 }
}
