import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e-real',testMatch:['**/g6-relations-real.spec.ts'],
 timeout:120_000,expect:{timeout:70_000},retries:0,workers:1,forbidOnly:Boolean(process.env.CI),
 reporter:[['list'],['json',{outputFile:'qa-evidence/g6-real-playwright.json'}]],
 outputDir:'qa-evidence/g6-real-browser',
 use:{baseURL:'http://127.0.0.1:15175',browserName:'chromium',viewport:{width:1440,height:950},trace:'off',screenshot:'only-on-failure'},
 webServer:{command:'npm run dev -- --port 15175',url:'http://127.0.0.1:15175',
  reuseExistingServer:false,env:{VITE_DATA_MODE:'live',VITE_API_BASE_URL:'',UAPM_DEV_API_TARGET:'http://127.0.0.1:13081'}}
});
