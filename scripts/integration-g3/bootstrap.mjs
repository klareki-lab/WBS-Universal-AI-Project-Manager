import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
const root=new URL('../../',import.meta.url);
await mkdir(new URL('.g3/',root),{recursive:true,mode:0o700});
const path=new URL('.g3/runtime.env',root);
try {await access(path); console.log('G3 configuration already exists');}
catch {const secret=()=>randomBytes(32).toString('base64url');
await writeFile(path,`G3_DB_PASSWORD=${secret()}\nG3_N8N_KEY=${secret()}\nG3_MCP_TOKEN=${secret()}\nG3_WEBHOOK_TOKEN=${secret()}\nG3_BACKEND_TOKEN=${secret()}\nG3_HUMAN_PASSWORD=${secret()}\nG3_SERVICE_ID=${randomUUID()}\nG3_PLANNING_MODE=fixture\n`,{mode:0o600}); console.log('Created ignored G3 configuration');}
