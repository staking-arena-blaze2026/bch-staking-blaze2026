import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compileString,utils} from 'cashc';
const bodies={};
for(const name of ['AssetGate','Allocation','Root','Node','Global']){
 let source=await readFile(`contracts/queue/${name}${['Node','Global'].includes(name)?'.template':''}.cash`,'utf8');
 for(const [key,body]of Object.entries(bodies))source=source.replaceAll(`__${key.toUpperCase()}_BODY__`,body);
 if(/__[A-Z0-9_]+__/.test(source))throw Error('Unresolved queue template');
 const artifact=compileString(source);bodies[name]=Buffer.from(utils.asmToBytecode(artifact.bytecode)).toString('hex');
 const path=`artifacts/queue/${name}.json`,stable=v=>{const x={...v};delete x.updatedAt;return JSON.stringify(x);};
 const old=JSON.parse(await readFile(path,'utf8').catch(()=>'{}'));
 if(process.argv.includes('--check')){if(stable(old)!==stable(artifact))throw Error(`Artifact mismatch: ${name}`);}
 else if(stable(old)!==stable(artifact)){await mkdir('artifacts/queue',{recursive:true});await writeFile(path,JSON.stringify(artifact,null,2)+'\n');}
 console.log(`${name}: ${bodies[name].length/2} body bytes`);
}
