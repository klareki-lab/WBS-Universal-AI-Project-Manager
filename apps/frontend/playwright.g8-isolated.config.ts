import {defineConfig} from '@playwright/test';
// Dedicated local G8 PostgreSQL and backend. Never points at existing services.
export default defineConfig({
 testDir:'./e2e-real',testMatch:['**/task-metadata-real.spec.ts','**/g8-brief-real.spec.ts','**/g8-team-real.spec.ts'],timeout:120_000,expect:{timeout:30_000},workers:1,retries:0,
 reporter:[['list']],outputDir:'qa-evidence/g8-isolated-browser',
 use:{baseURL:'http://127.0.0.1:35469',browserName:'chromium',viewport:{width:1440,height:1000},trace:'off',screenshot:'only-on-failure'},
 webServer:{command:'npm run dev -- --port 35469',url:'http://127.0.0.1:35469',reuseExistingServer:false,env:{VITE_DATA_MODE:'live',VITE_API_BASE_URL:'',UAPM_DEV_API_TARGET:'http://127.0.0.1:35468'}}
});
