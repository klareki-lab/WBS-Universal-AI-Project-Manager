import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const secrets=Object.fromEntries((await readFile(new URL('../../.g3/runtime.env',import.meta.url),'utf8')).trim().split('\n').map(l=>l.split('=')));
export const database=`postgresql://uapm:${secrets.G3_DB_PASSWORD}@localhost:25439/uapm_g3`;
export const env={...process.env,DATABASE_URL:database,AUTOMATION_SERVICE_ID:secrets.G3_SERVICE_ID,HOST:'127.0.0.1',PORT:'23081',ALLOWED_ORIGIN:'http://localhost:25173',COOKIE_SECURE:'false',N8N_ENDPOINT:process.env.G3_EXECUTION_PROFILE==='ai'?'http://localhost:25682/webhook/g3-ai/wf-01':'http://localhost:25682/webhook/g3/wf-01',N8N_TOKEN:secrets.G3_WEBHOOK_TOKEN,UAPM_BACKEND_MODE:'http',UAPM_BACKEND_BASE_URL:'http://localhost:23081',UAPM_BACKEND_SERVICE_TOKEN:secrets.G3_BACKEND_TOKEN,UAPM_MCP_SERVICE_TOKEN:secrets.G3_MCP_TOKEN,MCP_HOST:'127.0.0.1',MCP_PORT:'23082',VITE_DATA_MODE:'live',VITE_API_BASE_URL:'http://localhost:23081'};
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=process.argv[2];const specs={backend:['apps/backend',['start']],mcp:['apps/mcp-server',['start']],frontend:['apps/frontend',['dev','--','--host','localhost','--port','25173']]};
 const [dir,args]=specs[app]??[];if(!dir)throw new Error('Usage runtime.mjs backend|mcp|frontend');
 const child=spawn('npm',['run',...args],{cwd:root+'/'+dir,env,stdio:'inherit'});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
 child.on('exit',code=>process.exit(code??0));
}
