import {defineConfig,mergeConfig} from 'vite';
import base from './vite.config';
import {fileURLToPath} from 'node:url';
// Test-only dependency substitution; never imported by the production build.
export default mergeConfig(base,defineConfig({plugins:[{name:'wallet-test-transport',enforce:'pre',resolveId(source,importer){if(source==='./walletRelay'&&importer?.endsWith('/src/usePersistentWallet.ts'))return fileURLToPath(new URL('./tests/fixtures/wallet/transport.ts',import.meta.url));}}]}));
