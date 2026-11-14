import {defineConfig} from '@playwright/test';
import {launchOptions} from './scripts/browser-options.mjs';
export default defineConfig({testDir:'./tests/wallet-browser',timeout:120_000,workers:1,retries:0,expect:{timeout:15_000},use:{baseURL:'http://127.0.0.1:5174',launchOptions},webServer:{command:'VITE_INDEXER_MODE=off VITE_ARENA_NETWORK=chipnet VITE_V3_NETWORK=chipnet npm run dev -- --port 5174 --config vite.wallet-test.config.ts',url:'http://127.0.0.1:5174',reuseExistingServer:false},reporter:'list'});
