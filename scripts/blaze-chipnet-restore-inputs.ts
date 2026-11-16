/** Read-only retained-vault replay and every selected source proof on both providers. */
import {readFile,writeFile} from 'node:fs/promises';
import {BrowserElectrumProvider} from '../src/electrum-wss.js';
import {CHIPNET_ENDPOINTS} from '../src/chipnet-policy.js';
import {AssetIndexer,type Config} from '../src/v3/indexer.js';
import {verifyCoinsAcrossPeers} from '../src/electrum-wallet.js';
const catalog=JSON.parse(await readFile('frontend/public/v3-vaults.json','utf8'));
const p=new BrowserElectrumProvider({network:'chipnet',endpoints:CHIPNET_ENDPOINTS,allowBroadcast:false});
const rows=[];
for(const value of catalog.vaults){
 const config={...value,cap:BigInt(value.cap)} as Config,snapshot=await new AssetIndexer(p,config).sync();
 const inputs=await verifyCoinsAcrossPeers(p,snapshot.instance.inputs,true);
 rows.push({genesis:config.genesis,state:snapshot.instance.inputs[0].txid,inputs:snapshot.instance.inputs.map(i=>({txid:i.txid,vout:i.vout})),verifiedContext:inputs});
}
await writeFile('docs/blaze2026/chipnet-upgrade/restoration-inputs.json',JSON.stringify({at:new Date().toISOString(),providers:CHIPNET_ENDPOINTS,rows,broadcasts:0,walletConnected:false,scope:'All current retained public-vault state/reserve inputs, not future wallet inputs. Every financial action must freshly verify its entire selected input set.'},null,2)+'\n');
console.log('Verified retained vaults and all state/reserve inputs:',rows.length);
