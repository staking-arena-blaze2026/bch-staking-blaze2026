import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Public bundles carry compiled covenant artifacts, never private contract source/debug maps.
// Keep bytecode, ABI, constructor inputs and compiler identity exactly as compiled.
function compiledArtifactsOnly(): Plugin {
  return { name:'arena-compiled-contract-artifacts', apply:'build', enforce:'pre',
    transform(code,id) {
      if (!/\/artifacts\/(?:[^/]+\/)*[^/]+\.json$/.test(id)) return;
      const artifact=JSON.parse(code);
      delete artifact.debug;
      artifact.source='';
      return {code:JSON.stringify(artifact),map:null};
    },
  };
}

// Only documented GET endpoints are forwarded. BCHN RPC is never a proxy target.
const proxy = {
  '^/api/transactions/(?:plan|submit|genesis|admit|[a-fA-F0-9]{64})$': { target: 'http://127.0.0.1:3100', rewrite: (path: string) => path.replace(/^\/api/, '') },
  '^/api/(?:health|vaults(?:/[a-fA-F0-9]{64}(?:/(?:offers|rankings|periods|allocations|withdrawals|history))?)?)(?:\\?.*)?$': {
    target: 'http://127.0.0.1:3100',
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};
export default defineConfig({
  plugins: [react(), compiledArtifactsOnly()], base: './',
  worker: { format:'es', plugins:()=>[compiledArtifactsOnly()] },
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['@wizardconnect/react'] },
  server: { port: 5173, strictPort: true, proxy, fs: { strict: true, allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  preview: { port: 4173, strictPort: true, proxy },
  test: { server: { deps: { inline: [/@wizardconnect\//] } }, maxWorkers: 1, fileParallelism: false, environment: 'jsdom', setupFiles: ['tests/setup.ts'], include: ['tests/*.test.ts', 'tests/*.test.tsx'] },
});
