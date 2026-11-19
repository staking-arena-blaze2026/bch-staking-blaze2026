import { defineConfig } from '@playwright/test';
import { launchOptions, returningVisitor } from './scripts/browser-options.mjs';
const port=Number(process.env.ARENA_BROWSER_PORT??'5173');
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid ARENA_BROWSER_PORT');
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions,
    storageState: returningVisitor(port),
    // Keep DOM/network tracing; avoid continuous screencast captures on the VM.
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: { command: `VITE_V3_NETWORK=chipnet VITE_INDEXER_MODE=api VITE_API_BASE_URL=/api npm run dev -- --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, timeout: 30000 },
  reporter: [['list']],
});
