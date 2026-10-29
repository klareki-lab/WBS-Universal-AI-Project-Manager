// Actual n8n/model-node/guard/MCP/backend integration, MOCK PROVIDER ONLY.
// No OpenAI credential or external provider is used. Dedicated temporary mock ledger.
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {compile} from './compile.mjs';
import {ledger,budgetServer} from './budget.mjs';
import {root,secrets,database,env} from '../runtime.mjs';
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});
const plan={summary:'MOCK ONLY synthetic native-node validation',assumptions:['No real provider'],risks:[],phases:[{name:'Mock preparation',order:0},{name:'Mock verification',order:1}],tasks:[{tempId:'mock-a',phaseName:'Mock preparation',title:'MOCK ONLY: Prepare synthetic brief',priority:'medium',dependsOn:[],definitionOfDone:'Synthetic brief recorded'},{tempId:'mock-b',phaseName:'Mock verification',title:'MOCK ONLY: Verify local integration',priority:'high',dependsOn:['mock-a'],definitionOfDone:'Mock evidence recorded'}]};
const evidence={profile:'MOCK PROVIDER ONLY; native n8n AI profile clone',realAI:'NOT VERIFIED',startedAt:new Date().toISOString(),checks:[],nativeRequests:[]};
const folder=root+'/.g3/ai-mock-'+Date.now();await mkdir(folder,{mode:0o700});
const db=ledger(folder+'/mock-budget.sqlite');
const guard=budgetServer({db,authorized:async()=>true,verifyOperation:async id=>{const {rows}=await pool.query("SELECT status FROM operation_jobs WHERE id=$1",[id]);assert.equal(rows[0]?.status,'running')},upstream:async(url,options)=>{
 const body=JSON.parse(options.body),text=body.messages.map(m=>m.content).join('\n');
 evidence.nativeRequests.push({model:body.model,maxTokens:body.max_tokens,responseFormat:body.response_format,inputBytes:Buffer.byteLength(options.body)});
 let output;if(text.includes('You are the Coordinator.'))output={intent:'plan',projectId:text.match(/"projectId":"([a-f0-9-]+)"/)[1],rationale:'MOCK ONLY synthetic coordination',question:null};
 else if(text.includes('You are the Planner.'))output=plan;
 else if(text.includes('You are the Reviewer.'))output={ok:true,issues:[],revisedPlan:null};else throw new Error('Unexpected mock prompt');
 return new Response(JSON.stringify({id:'mock-only-'+randomUUID(),object:'chat.completion',created:Math.floor(Date.now()/1000),model:'gpt-4.1-mini-2025-04-14',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}),{headers:{'content-type':'application/json','x-request-id':'mock-only-'+randomUUID()}});
}});
guard.on('request',req=>{(evidence.receivedRoutes??=[]).push({method:req.method,url:req.url})});
await new Promise(r=>guard.listen(23085,'127.0.0.1',r));
const args=['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml'];
function docker(tail){const r=spawnSync('docker',[...args,...tail],{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('Isolated mock workflow provisioning failed');}
let backend;
try{
 const workflows=await compile();
 for(const w of workflows){w.id=w.id.replace('G3AIWorkflow','G3MockAIWf');w.name='MOCK ONLY '+w.name;w.active=false;for(const n of w.nodes){if(n.type.endsWith('.webhook')){n.parameters.path=n.parameters.path.replace('g3-ai/','g3-ai-mock/');n.webhookId='mock-'+n.webhookId}if(n.type.endsWith('.executeWorkflow'))n.parameters.workflowId=n.parameters.workflowId.replace('G3AIWorkflow','G3MockAIWf');if(n.type.endsWith('.lmChatOpenAi')){n.parameters.options.baseURL=n.parameters.options.baseURL.replace(':23083',':23085');n.credentials.openAiApi={id:'G3AIMockCred001',name:'MOCK ONLY OpenAI protocol credential'}}}await writeFile(folder+'/'+w.id+'.json',JSON.stringify(w));}
 const credentialFile=folder+'/credential.json';await writeFile(credentialFile,JSON.stringify([{id:'G3AIMockCred001',name:'MOCK ONLY OpenAI protocol credential',type:'openAiApi',data:{apiKey:'mock-not-a-provider-key',url:'http://host.docker.internal:23085/v1'}}]),{mode:0o600});
 docker(['cp',credentialFile,'n8n:/tmp/g3-mock-credential.json']);docker(['exec','-T','-u','root','n8n','chmod','644','/tmp/g3-mock-credential.json']);docker(['exec','-T','n8n','n8n','import:credentials','--input=/tmp/g3-mock-credential.json']);
 // Copy only workflow JSON, never the temporary mock credential/ledger to workflow importer.
 const wfFolder=folder+'/workflows';await mkdir(wfFolder);for(const w of workflows)await writeFile(wfFolder+'/'+w.id+'.json',JSON.stringify(w));
 docker(['cp',wfFolder+'/.','n8n:/tmp/g3-ai-mock-workflows']);docker(['exec','-T','n8n','n8n','import:workflow','--separate','--input=/tmp/g3-ai-mock-workflows']);
 for(const w of workflows)docker(['exec','-T','n8n','n8n','update:workflow','--id='+w.id,'--active=true']);docker(['exec','-T','-u','root','n8n','rm','-rf','/tmp/g3-mock-credential.json','/tmp/g3-ai-mock-workflows']);docker(['restart','n8n']);
 for(let i=0;i<30;i++){try{if((await fetch('http://localhost:25682/healthz')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}
 // Caller must have stopped only the verified G3 backend before running this test.
 backend=spawn(process.execPath,['dist/apps/backend/src/server.js'],{cwd:root+'/apps/backend',env:{...env,N8N_ENDPOINT:'http://localhost:25682/webhook/g3-ai-mock/wf-01'},stdio:'ignore'});
 for(let i=0;i<30;i++){try{if((await fetch('http://localhost:23081/ready')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}
 const login=await fetch('http://localhost:23081/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'g3-owner@example.invalid',password:secrets.G3_HUMAN_PASSWORD})});assert.equal(login.status,200);const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
 const req=async(path,body)=>{const r=await fetch('http://localhost:23081/api/v1'+path,{method:'POST',headers:{cookie,'x-csrf-token':auth.csrf_token,'idempotency-key':randomUUID(),'content-type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,'Mock request failed: '+r.status);return r.json()};
 const project=await req('/projects',{name:'SYNTHETISCH MOCK ONLY native AI '+Date.now()});const op=await req(`/projects/${project.id}/agent/planning-requests`,{prompt:'SYNTHETISCH MOCK ONLY: Plane einen kleinen internen Workshop.'});
 let job;for(let i=0;i<60;i++){job=(await pool.query('SELECT * FROM operation_jobs WHERE id=$1',[op.id])).rows[0];if(['failed','succeeded'].includes(job.status))break;await new Promise(r=>setTimeout(r,1000))}
 evidence.operation={id:op.id,projectId:project.id,status:job.status,attempts:job.attempts,requestId:job.request_id,contextHash:job.context_hash,baseProjectVersion:job.input.base_project_version};
 evidence.mockCalls=db.prepare('SELECT * FROM calls').all();
 assert.equal(job.status,'succeeded');assert.equal(job.attempts,1);assert.equal(evidence.mockCalls.length,3);assert.ok(evidence.mockCalls.every(c=>c.status==='success'));
 const draft=(await pool.query('SELECT id,status,content_hash,origin_operation_id,snapshot FROM plan_versions WHERE origin_operation_id=$1',[op.id])).rows[0];assert.equal(draft.status,'draft');assert.equal(draft.snapshot.tasks.length,2);assert.ok(draft.snapshot.tasks.every(t=>t.title.startsWith('MOCK ONLY:')));evidence.plan={id:draft.id,status:draft.status,contentHash:draft.content_hash,originOperationId:draft.origin_operation_id};
 assert.equal((await pool.query('SELECT count(*)::int n FROM tasks WHERE project_id=$1',[project.id])).rows[0].n,0);
 evidence.checks.push({name:'Native Coordinator/Planner/Reviewer model nodes → local budget guard → strict schema → MCP → original immutable draft, with mock provider only',result:'PASS'},{name:'Mock path creates no approval or published tasks',result:'PASS'});evidence.result='PASS';console.log('PASS native three-model profile with MOCK provider only; real AI remains NOT VERIFIED');
}catch(e){evidence.result='FAIL';evidence.failure=e.message;console.error(e.message);process.exitCode=1}
finally{
 if(backend){backend.kill('SIGTERM');await new Promise(r=>backend.once('exit',r))}
 await new Promise(r=>guard.close(r));db.close();await pool.end();
 // Disable test clones without changing the actual AI or deterministic workflows.
 for(let i=1;i<=3;i++)try{docker(['exec','-T','n8n','n8n','update:workflow',`--id=G3MockAIWf0000${i}`,'--active=false'])}catch{}
 try{docker(['restart','n8n'])}catch{}
 await writeFile(root+'/docs/integration-g3/evidence/ai-native-mock.json',JSON.stringify(evidence,null,2)+'\n');
}
