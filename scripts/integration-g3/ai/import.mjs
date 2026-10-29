import {spawnSync} from 'node:child_process';
import {root} from './compile.mjs';
const args=['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml'];
// Exact IDs only: never toggle or overwrite deterministic workflows.
for(const tail of [['cp','automation/n8n/ai-profile/.','n8n:/tmp/g3-ai-workflows'],['exec','-T','n8n','n8n','import:workflow','--separate','--input=/tmp/g3-ai-workflows'],...Array.from({length:3},(_,i)=>['exec','-T','n8n','n8n','update:workflow',`--id=G3AIWorkflow0000${i+1}`,'--active=true']),['exec','-T','-u','root','n8n','rm','-rf','/tmp/g3-ai-workflows'],['restart','n8n']]){
 const r=spawnSync('docker',[...args,...tail],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
