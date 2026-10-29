import {defineConfig} from '@playwright/test';
import original from './playwright.config';
// Dedicated ports ensure this suite never reuses an agent's existing UI server.
export default defineConfig({
 ...original,
 use:{...original.use,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
 projects:original.projects?.map(p=>({...p,use:{...p.use,baseURL:p.name==='live-http-fixtures'?'http://localhost:25274':'http://localhost:25273'}})),
 webServer:[
  {command:'npm run dev -- --host localhost --port 25273',url:'http://localhost:25273',reuseExistingServer:false,env:{VITE_DATA_MODE:'mock',VITE_API_BASE_URL:''}},
  {command:'npm run dev -- --host localhost --port 25274',url:'http://localhost:25274',reuseExistingServer:false,env:{VITE_DATA_MODE:'live',VITE_API_BASE_URL:''}},
 ],
});
