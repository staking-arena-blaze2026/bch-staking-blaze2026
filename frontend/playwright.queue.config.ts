import {defineConfig} from '@playwright/test';
import existing from './playwright.electrum.config';
export default defineConfig({...existing,testDir:'./tests/queue',timeout:240000,webServer:{command:'ARENA_STATIC_PORT=4176 node scripts/static-server.mjs',url:'http://127.0.0.1:4176/v3/',reuseExistingServer:false,timeout:30000},use:{...existing.use,baseURL:'http://127.0.0.1:4176/v3/'}});
