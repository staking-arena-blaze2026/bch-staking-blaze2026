/** Run legacy RPC-dependent protocol checks only inside a disposable local node. */
import {spawn} from 'node:child_process';
import {isolatedRegtest} from '../tests/fixtures/isolated-regtest.js';
const files=process.argv.slice(2);
if(!files.length)files.push('tests/v3-adversarial.test.ts');
if(files.some(file=>!/^tests\/[a-z0-9-]+\.test\.ts$/.test(file)))throw Error('Expected repository protocol test paths');
await isolatedRegtest(async()=>{
 const code=await new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',env:{...process.env}});
  child.once('error',reject);child.once('exit',code=>resolve(code??1));
 });
 if(code!==0)throw Error('Isolated protocol checks failed');
},18538);
