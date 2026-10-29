import {readFile,writeFile,readdir,copyFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root,database,secrets} from './runtime.mjs';
const{default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});
function parseFlat(text){const table=JSON.parse(text),cache=new Map();function at(i){if(cache.has(i))return cache.get(i);const v=table[i];if(v===null||typeof v!=='object')return v;const out=Array.isArray(v)?[]:{};cache.set(i,out);for(const[k,x]of Object.entries(v))out[k]=typeof x==='string'?at(Number(x)):x;return out}return at(0)}
const cookie=await readFile(root+'/.g3/n8n-cookie','utf8');
const records=await fetch('http://localhost:25682/rest/executions',{headers:{cookie}}).then(r=>r.json());
const executions=[];
for(let n=1;n<=6;n++){
 const id='G3Workflow000000'+n;const match=records.data.results.find(e=>e.workflowId===id&&e.status==='success');
 if(!match){executions.push({workflowId:id,result:'NOT VERIFIED'});continue;}
 const detail=await fetch('http://localhost:25682/rest/executions/'+match.id,{headers:{cookie}}).then(r=>r.json());const data=parseFlat(detail.data.data);
 executions.push({workflowId:id,executionId:match.id,result:'PASS',startedAt:match.startedAt,stoppedAt:match.stoppedAt,nodes:Object.entries(data.resultData.runData).map(([name,runs])=>({name,runs:runs.map(r=>({status:r.executionStatus,timeMs:r.executionTime}))}))});
}
const credentials=await fetch('http://localhost:25682/rest/credentials',{headers:{cookie}}).then(r=>r.json());
const files=await readdir(root+'/.g3/workflows');const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(root+'/.g3/workflows/'+file)).digest('hex');
await writeFile(root+'/docs/integration-g3/evidence/n8n.json',JSON.stringify({profile:'deterministic fixtures; no model calls',executions,compiledWorkflowHashes:hashes,isolatedCredentialCount:Array.isArray(credentials.data)?credentials.data.length:null,realAI:'NOT VERIFIED',environmentOpenAICredential:Boolean(process.env.OPENAI_API_KEY)},null,2));
try{
 const browser=JSON.parse(await readFile(root+'/docs/integration-g3/evidence/browser.json','utf8'));
 const migrations=(await pool.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
 const provenance=(await pool.query('SELECT p.id plan_id,p.project_id,p.status,p.content_hash,p.origin_operation_id,o.request_id,o.context_hash,o.input->>\'base_project_version\' original_base,o.status operation_status FROM plan_versions p JOIN operation_jobs o ON o.id=p.origin_operation_id WHERE p.id=$1',[browser.planId])).rows;
 const events=(await pool.query('SELECT type,entity_id,actor_id,request_id,created_at FROM activity_events WHERE project_id=$1 ORDER BY created_at,id',[browser.projectId])).rows;
 const containers=spawnSync('docker',['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml','ps','--format','json'],{cwd:root,encoding:'utf8'}).stdout.trim().split('\n').filter(Boolean).map(JSON.parse).map(c=>({name:c.Name,image:c.Image,state:c.State,health:c.Health,ports:c.Ports}));
 const image=spawnSync('docker',['image','inspect','uapm-g3-backend:local','--format','{{.Id}}'],{encoding:'utf8'}).stdout.trim();
 await writeFile(root+'/docs/integration-g3/evidence/runtime.json',JSON.stringify({database:'uapm_g3 in new uapm-g3-postgres-1',migrations,containers,backendImage:image,provenance,events},null,2));
}finally{await pool.end()}
console.log('Collected six workflow execution summaries, isolated migration/runtime evidence and provenance without credentials');
