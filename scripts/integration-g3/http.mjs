import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {root,secrets,database} from './runtime.mjs';
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');
const {hash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');
const pool=new pg.Pool({connectionString:database});
const checks=[],responses=[];const record=(name)=>{checks.push({name,result:'PASS'});console.log('PASS',name)};
let human={};const service={bearer:secrets.G3_BACKEND_TOKEN};
async function req(method,path,body,actor=human,key=randomUUID()){
 const headers={};if(actor.cookie){headers.cookie=actor.cookie;headers['x-csrf-token']=actor.csrf;}if(actor.bearer)headers.authorization='Bearer '+actor.bearer;
 if(method!=='GET')headers['idempotency-key']=key;if(body!==undefined)headers['content-type']='application/json';
 const r=await fetch('http://localhost:23081'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(r.status===429){const delay=Math.min(60,Number(r.headers.get('retry-after'))||60);await new Promise(resolve=>setTimeout(resolve,delay*1000));return req(method,path,body,actor,key)}const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
 responses.push({method,path,status:r.status,requestId:r.headers.get('x-request-id'),code:data?.error?.code});return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function mcp(tool,args){const r=await fetch('http://localhost:23082/mcp/call-tool',{method:'POST',headers:{authorization:'Bearer '+secrets.G3_MCP_TOKEN,'content-type':'application/json','x-correlation-id':randomUUID()},body:JSON.stringify({tool,arguments:args})});return {status:r.status,data:await r.json()}}
async function wf(n,packet){const r=await fetch('http://localhost:25682/webhook/g3/wf-'+n,{method:'POST',headers:{authorization:'Bearer '+secrets.G3_WEBHOOK_TOKEN,'content-type':'application/json'},body:JSON.stringify(packet)});return {status:r.status,data:await r.json()}}
const prefix=id=>'/api/v1/projects/'+id;
try{
 const login=await req('POST','/api/v1/auth/login',{email:'g3-owner@example.invalid',password:secrets.G3_HUMAN_PASSWORD},{});assert.equal(login.status,200);human={cookie:login.cookie,csrf:login.data.csrf_token};
 const created=await req('POST','/api/v1/projects',{name:'SYNTHETISCH G3 HTTP '+Date.now()});assert.equal(created.status,201);const pid=created.data.id,p=prefix(pid);
 await pool.query("INSERT INTO project_members(project_id,user_id,role) SELECT $1,id,'editor' FROM users WHERE email='g3-planner@service.invalid' ON CONFLICT DO NOTHING",[pid]);
 const original=JSON.parse(await readFile(root+'/packages/contracts/fixtures/plan-create.json','utf8'));original.base_project_version=1;
 const dr=await req('POST',p+'/plans',original);assert.equal(dr.status,201);const draft=dr.data;assert.ok(draft.id);
 assert.equal((await mcp('get_plan_version',{projectId:pid,planVersionId:draft.id})).data.id,draft.id);record('Scoped MCP read reaches real backend');
 const invalidSchema=await mcp('get_plan_version',{planVersionId:draft.id});assert.notEqual(invalidSchema.status,200);record('Unscoped child tool request rejected');
 const wrongScope=await mcp('get_plan_version',{projectId:randomUUID(),planVersionId:draft.id});assert.equal(wrongScope.data.error.backendCode,'project_not_found');assert.ok(wrongScope.data.error.backendRequestId);record('Project isolation and actionable MCP backend errors');
 assert.equal((await req('POST',p+'/plans/'+draft.id+'/approvals',{content_hash:draft.content_hash,decision:'approved'},service)).status,403);record('Service actor cannot approve even through direct HTTP');
 assert.equal((await mcp('submit_review',{projectId:pid,planVersionId:draft.id,idempotencyKey:randomUUID()})).status,200);
 assert.equal((await mcp('request_plan_approval',{projectId:pid,planVersionId:draft.id,idempotencyKey:randomUUID()})).status,200);record('MCP submit-review precedes request-approval');
 assert.equal((await req('POST',p+'/plans/'+draft.id+'/approvals',{content_hash:'0'.repeat(64),decision:'approved'})).status,409);record('Exact hash enforced');
 assert.equal((await req('POST',p+'/plans/'+draft.id+'/approvals',{content_hash:draft.content_hash,decision:'approved'})).status,201);
 const packet={request:{projectId:pid,principal:{correlationId:randomUUID()}},operation:{name:'publish_approved_plan',arguments:{projectId:pid,planVersionId:draft.id,contentHash:draft.content_hash,idempotencyKey:randomUUID()}}};
 const published=await wf('05',packet);assert.equal(published.status,200);assert.match(published.data.response,/Mutation succeeded/);record('WF-05 executed authorized publication through real MCP and PostgreSQL');
 const replay=await wf('05',packet);assert.equal(replay.status,200);assert.deepEqual(replay.data.operationIds,published.data.operationIds);
 assert.equal((await pool.query('SELECT count(*)::int n FROM tasks WHERE project_id=$1',[pid])).rows[0].n,original.snapshot.tasks.length);record('Repeated executor request creates no duplicate tasks');
 const read=await wf('04',{request:{projectId:pid,principal:{correlationId:randomUUID()}},decision:{}});assert.equal(read.status,200);assert.match(read.data.response,/12 tasks/);record('WF-04 executed persisted project/progress/task reads');
 const err=await wf('06',{error:{code:'backend_unavailable',message:'Synthetic'},request:{principal:{correlationId:randomUUID()}},operationIds:published.data.operationIds});assert.equal(err.status,200);assert.equal(err.data.retryable,true);record('WF-06 executed operation error reporting');
 const task=(await req('GET',p+'/tasks')).data.items[0];
 const detail=await mcp('get_task',{projectId:pid,taskId:task.id});assert.equal(detail.status,200);assert.equal(detail.data.dependencies.length,(await pool.query('SELECT count(*)::int n FROM task_dependencies WHERE task_id=$1',[task.id])).rows[0].n);record('Scoped MCP task detail includes persisted dependencies');
 const proposed=await mcp('update_task',{projectId:pid,taskId:task.id,expectedVersion:task.version,changes:{title:'SYNTHETISCH proposal only'},idempotencyKey:randomUUID()});assert.equal(proposed.status,200);assert.equal(proposed.data.requiresApproval,true);assert.equal(proposed.data.planVersion.status,'draft');assert.equal((await req('GET',p+'/tasks/'+task.id)).data.title,task.title);record('MCP update_task creates a draft and leaves published task unchanged');
 assert.equal((await req('PATCH',p+'/tasks/'+task.id+'/status',{version:task.version+1,status:'in_progress'})).status,409);record('Stale task write rejected');
 const project=(await req('GET',p)).data;
 const concurrent=await Promise.all(['A','B'].map(name=>req('PATCH',p,{version:project.version,description:'SYNTHETISCH concurrent '+name})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);record('Concurrent project updates: one commit, one conflict');
 const current=(await req('GET',p)).data;
 const revision={...original,base_project_version:current.version};revision.snapshot=structuredClone(original.snapshot);revision.snapshot.tasks[0].title='SYNTHETISCH revised title';
 const key=randomUUID();const newPlan=await req('POST',p+'/plans',revision,human,key);assert.equal(newPlan.status,201);assert.equal((await req('POST',p+'/plans',revision,human,key)).data.id,newPlan.data.id);assert.equal((await req('GET',p+'/plans/'+draft.id)).data.content_hash,draft.content_hash);record('Immutable revision history and exact-key replay');
 await req('POST',p+'/plans/'+newPlan.data.id+'/submit-review');await req('POST',p+'/plans/'+newPlan.data.id+'/approvals',{content_hash:newPlan.data.content_hash,decision:'approved'});
 const revoked=await req('POST',p+'/plans/'+newPlan.data.id+'/revoke-approval',{reason:'SYNTHETISCH P1 revocation'});assert.equal(revoked.status,201);
 const attempt=await req('POST',p+'/plans/'+newPlan.data.id+'/publish',{content_hash:newPlan.data.content_hash},service);assert.equal(attempt.data.error.code,'approval_revoked');
 assert.equal((await mcp('get_approval_status',{projectId:pid,planVersionId:newPlan.data.id})).data.state,'expired');record('Revoked approval cannot authorize publication; MCP reports invalidated state');
 const job=await req('POST',p+'/agent/planning-requests',{prompt:'SYNTHETISCH pending callback tests'});assert.equal(job.status,202);
 for(const body of [{},{result:revision,error:'both'}])assert.equal((await req('POST','/api/v1/operations/'+job.data.id+'/result',body,service)).status,400);record('Strict operation callback union rejects neither/both');
 const mismatch=await mcp('store_agent_result',{projectId:pid,operationId:job.data.id,requestId:randomUUID(),baseProjectVersion:current.version+50,payload:{error:'SYNTHETISCH'},idempotencyKey:randomUUID()});assert.equal(mismatch.data.error.code,'conflict');record('Callback cannot relabel original base version');
 // Create a limited identity only in this fixture database, then test real server scopes.
 const limited=randomBytes(32).toString('base64url');const u=await pool.query("INSERT INTO users(email,display_name,kind,token_hash,scopes,token_expires_at) VALUES($1,'SYNTHETISCH read-only service','service',$2,$3,now()+interval '1 hour') RETURNING id",['g3-limited-'+randomUUID()+'@service.invalid',hash(limited),['read']]);await pool.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",[pid,u.rows[0].id]);assert.equal((await req('POST',p+'/plans',revision,{bearer:limited})).data.error.code,'insufficient_scope');record('Service write scope enforced server-side');
 const noCsrf=await req('POST',p+'/plans',revision,{cookie:human.cookie,csrf:'bad'});assert.equal(noCsrf.status,403);record('Cookie mutation requires CSRF');
 await pool.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[hash(human.cookie.split('=')[1])]);assert.equal((await req('GET',p)).status,401);record('Expired human session rejected');
 await pool.query('UPDATE users SET token_expires_at=now()-interval \'1 second\' WHERE id=$1',[u.rows[0].id]);assert.equal((await req('GET',p,undefined,{bearer:limited})).status,401);record('Expired service credential rejected');
 await writeFile(root+'/docs/integration-g3/evidence/http.json',JSON.stringify({result:'PASS',checks,responses,projectId:pid},null,2));
}catch(e){await writeFile(root+'/docs/integration-g3/evidence/http.json',JSON.stringify({result:'FAIL',checks,responses,error:e.stack},null,2));console.error(e);process.exitCode=1}
finally{await pool.end()}
