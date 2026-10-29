// Read-only, allowlisted real-run evidence. Never exports raw n8n packets/headers.
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {root,database} from '../runtime.mjs';
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');
const pool=new pg.Pool({connectionString:database});
const browser=JSON.parse(await readFile(root+'/docs/integration-g3/evidence/ai-browser.json','utf8'));
const cookie=await readFile(root+'/.g3/n8n-cookie','utf8');
const get=async path=>{const r=await fetch('http://localhost:25682/rest/'+path,{headers:{cookie}});if(!r.ok)throw new Error('G3 n8n evidence unavailable');return(await r.json()).data};
function parseFlat(text){const a=JSON.parse(text),cache=new Map();function at(i){if(cache.has(i))return cache.get(i);const v=a[i];if(v===null||typeof v!=='object')return v;const o=Array.isArray(v)?[]:{};cache.set(i,o);for(const[k,x]of Object.entries(v))o[k]=typeof x==='string'?at(Number(x)):x;return o}return at(0)}
const evidence={collectedAt:new Date().toISOString(),dataClassification:'Synthetic G3 project data; credential/header values excluded',ownerDecision:browser.ownerDecision,browserResult:browser.result,realAI:browser.realAI,executionIds:[],executions:[]};
try{
 const {results}=await get('executions?limit=100');
 for(const e of results.filter(e=>/^G3AIWorkflow/.test(e.workflowId)&&e.startedAt>=browser.startedAt)){
  const d=await get('executions/'+e.id),data=parseFlat(d.data),runs=data.resultData.runData;
  const packet=Object.values(runs).flat().flatMap(r=>r.data?.main?.flat()??[]).find(i=>i.json?.operation?.operation_id===browser.operation?.id||i.json?.operation_id===browser.operation?.id);
  if(!packet)continue;
  evidence.executionIds.push(e.id);evidence.executions.push({id:e.id,workflowId:e.workflowId,status:e.status,startedAt:e.startedAt,stoppedAt:e.stoppedAt,operationId:browser.operation.id,nodes:Object.entries(runs).map(([name,rs])=>({name,runs:rs.map(r=>({status:r.executionStatus,timeMs:r.executionTime}))}))});
 }
 const db=new DatabaseSync(root+'/.g3/ai-budget.sqlite',{readOnly:true});evidence.providerCalls=db.prepare('SELECT * FROM calls ORDER BY id').all();evidence.ledgerSummary=db.prepare('SELECT count(*) calls,coalesce(sum(reserved_usd),0) reservedUsd FROM calls').get();db.close();
 evidence.operations=(await pool.query('SELECT id,project_id,created_by,kind,status,input,result,error,attempts,max_attempts,request_id,context_hash,created_at,updated_at FROM operation_jobs WHERE project_id=$1 ORDER BY created_at',[browser.projectId])).rows;
 evidence.plans=(await pool.query('SELECT id,project_id,number,base_project_version,status,snapshot,content_hash,origin_operation_id,created_by,created_at,published_at FROM plan_versions WHERE project_id=$1 ORDER BY number',[browser.projectId])).rows;
 evidence.approvals=(await pool.query('SELECT a.id,a.plan_version_id,a.content_hash,a.decision,a.user_id,u.kind,a.created_at FROM approvals a JOIN users u ON u.id=a.user_id WHERE a.project_id=$1',[browser.projectId])).rows;
 evidence.tasks=(await pool.query('SELECT id,project_id,title,status,source_plan_id,source_key,version,definition_of_done FROM tasks WHERE project_id=$1 ORDER BY created_at,id',[browser.projectId])).rows;
 evidence.events=(await pool.query('SELECT id,type,entity_id,actor_id,request_id,data,created_at FROM activity_events WHERE project_id=$1 ORDER BY created_at,id',[browser.projectId])).rows;
 evidence.estimatedUsd=evidence.providerCalls.reduce((sum,c)=>{const u=JSON.parse(c.usage||'null');return sum+(u?(u.prompt_tokens*0.4+u.completion_tokens*1.6)/1e6:0)},0);
 evidence.providerModelExecutionVerified=evidence.providerCalls.some(c=>c.status==='success'&&c.provider_request_id&&c.completion_id);
 evidence.fullGenuineLifecycleVerified=browser.result==='PASS'&&browser.realAI==='VERIFIED'&&evidence.providerCalls.length===3&&evidence.providerCalls.every(c=>c.status==='success')&&evidence.executions.length===3&&evidence.executions.every(e=>e.status==='success')&&evidence.plans.some(p=>p.status==='published')&&evidence.approvals.some(a=>a.kind==='human'&&a.decision==='approved')&&evidence.tasks.length>0;
 await writeFile(root+'/docs/integration-g3/evidence/ai-real.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({browserResult:evidence.browserResult,fullGenuineLifecycleVerified:evidence.fullGenuineLifecycleVerified,executionIds:evidence.executionIds,ledger:evidence.ledgerSummary,estimatedUsd:evidence.estimatedUsd}));
}finally{await pool.end()}
