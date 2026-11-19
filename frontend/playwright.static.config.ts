import { returningVisitor } from './scripts/browser-options.mjs';
import { defineConfig } from '@playwright/test';
import existing from './playwright.config';
export default defineConfig({
  ...existing,
  testDir: './tests/static',
  use: { ...existing.use, storageState:returningVisitor(4174), baseURL: 'http://127.0.0.1:4174' },
  webServer: { command: 'node scripts/static-server.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 30000 },
});
