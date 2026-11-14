import {readFile,writeFile} from 'node:fs/promises';
import {compileFile,compileString,utils} from 'cashc';
const bodies={};
for(const name of ['FeeSponsorV3','AssetRoleV3','StakeAllocationV3','RewardFundingV3','RegistryV3','RegistryGenesisV3','RegistryGenesisV4']) {
 let source;
 if(name==='RegistryV3'||name==='RegistryGenesisV3'||name==='RegistryGenesisV4') {
  source=await readFile(`contracts/v3/${name}.template.cash`,'utf8');
  for(const [key,body] of Object.entries(bodies))source=source.replaceAll(`__${key.toUpperCase()}_BODY__`,body);
  source=source.replaceAll('__EMPTY_STATE__','00'.repeat(790));
  if(/__[A-Z0-9_]+__/.test(source))throw Error('Unresolved v3 covenant template');
 }
 const artifact=source?compileString(source):compileFile(`contracts/v3/${name}.cash`);
 bodies[name]=Buffer.from(utils.asmToBytecode(artifact.bytecode)).toString('hex');
 await writeFile(`artifacts/${name}.json`,JSON.stringify(artifact,null,2)+'\n');
}
