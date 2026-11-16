import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compileFile,compileString,utils} from 'cashc';
const bodies={};
for(const name of ['FeeSponsorV3','AssetRoleV3','StakeAllocationV3','RewardFundingV3','RegistryV3','RegistryGenesisV3','RegistryGenesisV4','RegistryAtomicV4','RegistryAtomicGenesisV4','RegistryAtomicLinkedGenesisV4']) {
 let source;
 if(name.startsWith('Registry')) {
  source=await readFile(`contracts/v3/${name}.template.cash`,'utf8');
  for(const [key,body] of Object.entries(bodies))source=source.replaceAll(`__${key.toUpperCase()}_BODY__`,body);
  source=source.replaceAll('__EMPTY_STATE__','00'.repeat(790));
  if(/__[A-Z0-9_]+__/.test(source))throw Error('Unresolved v3 covenant template');
 }
 const artifact=source?compileString(source):compileFile(`contracts/v3/${name}.cash`);
 bodies[name]=Buffer.from(utils.asmToBytecode(artifact.bytecode)).toString('hex');
 // Original artifacts remain immutable for existing <=16-release vaults.
 const directory=name.startsWith('Registry')?'artifacts/releases1000':'artifacts';
 if(!process.argv.includes('--check'))await mkdir(directory,{recursive:true});
 const path=`${directory}/${name}.json`;
 const existing=JSON.parse(await readFile(path,'utf8').catch(()=>'{"updatedAt":null}'));
 const stable=value=>{const copy={...value};delete copy.updatedAt;return JSON.stringify(copy);};
 if(process.argv.includes('--check')){if(stable(existing)!==stable(artifact))throw Error(`Contract artifact mismatch: ${name}`);}
 else if(stable(existing)!==stable(artifact))await writeFile(path,JSON.stringify(artifact,null,2)+'\n');
}
