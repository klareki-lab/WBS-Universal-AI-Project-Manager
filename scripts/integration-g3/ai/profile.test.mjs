import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {compile} from './compile.mjs';
import {validators} from './validation.mjs';
import {ledger,budgetServer,limits,reserve} from './budget.mjs';
const operation='11111111-1111-4111-8111-111111111111';
const plan={summary:'Synthetic test',assumptions:[],risks:[],phases:[{name:'A',order:0},{name:'B',order:1}],tasks:[{tempId:'a',phaseName:'A',title:'Brief',priority:'medium',dependsOn:[],definitionOfDone:'Brief recorded'},{tempId:'b',phaseName:'B',title:'Verify',priority:'high',dependsOn:['a'],definitionOfDone:'Checks recorded'}]};
const validRequest={model:limits.model,max_tokens:1200,response_format:{type:'json_object'},messages:[{role:'user',content:'Return JSON for synthetic test'}]};
const completion={id:'mock-completion',model:'gpt-4.1-mini-2025-04-14',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan)}}],usage:{prompt_tokens:20,completion_tokens:150,total_tokens:170}};
const provider=()=>new Response(JSON.stringify(completion),{headers:{'x-request-id':'mock-provider-request'}});
async function fixture(t,options={}) {
 const dir=await mkdtemp(tmpdir()+'/g3-ai-test-'),db=ledger(dir+'/ledger.sqlite');
 let calls=0;
 const server=budgetServer({db,authorized:async()=>true,verifyOperation:async()=>{},upstream:async(...args)=>{calls++;return provider(...args)},...options});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();await rm(dir,{recursive:true,force:true})});
 const request=(stage='coordinator',body=validRequest,auth='Bearer mock-not-a-real-key')=>fetch(`http://127.0.0.1:${server.address().port}/operations/${operation}/${stage}/v1/chat/completions`,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)});
 return{db,request,calls:()=>calls};
}
test('Separate AI graph preserves native OpenAI credential nodes, no fixtures/tools/approval routes',async()=>{
 const workflows=await compile();assert.equal(workflows.length,3);
 for(const w of workflows){assert.match(w.id,/^G3AIWorkflow/);assert.equal(w.active,false);assert.equal(w.settings.executionTimeout,55);const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
  for(const n of w.nodes){assert.equal(n.retryOnFail,false);assert.doesNotMatch(n.name,/Fixture|Mutation Executor/);if(n.type.endsWith('.lmChatOpenAi')){assert.equal(n.credentials.openAiApi.id,'uapm-openai');assert.equal(n.typeVersion,1);assert.equal(n.parameters.options.maxRetries,0);assert.equal(n.parameters.options.maxTokens,1200);assert.equal(n.parameters.options.timeout,12000);assert.match(n.parameters.options.baseURL,/23083/)}assert.ok(!/ai_tool|ai_memory/.test(JSON.stringify(w.connections)));}
  for(const c of Object.values(w.connections))for(const outputs of Object.values(c))for(const links of outputs)for(const link of links)assert.ok(names.has(link.node),link.node);
  const path=new URL(`../../../automation/n8n/ai-profile/${w.id}.json`,import.meta.url);assert.deepEqual(JSON.parse(await readFile(path)),w);
 }
 const entry=workflows[0].nodes.find(n=>n.type.endsWith('.webhook'));assert.equal(entry.parameters.responseMode,'onReceived');assert.equal(entry.parameters.options.responseCode.values.customCode,202);
 assert.equal(workflows.flatMap(w=>w.nodes).filter(n=>n.type.endsWith('.chainLlm')).length,3);
});
test('Strict planner schema rejects malformed JSON, extra authority, scope changes, invalid dependencies and dates',()=>{
 const v=validators();assert.deepEqual(v.plan(plan),plan);
 for(const mutate of [p=>p.approved=true,p=>p.tasks[0].dueDate='2026-01-01',p=>p.tasks[0].dependsOn=['b'],p=>p.tasks[1].tempId='a',p=>p.tasks[0].definitionOfDone='',p=>p.tasks[0].phaseName='Other']){const p=structuredClone(plan);mutate(p);assert.throws(()=>v.plan(p),/AI_SCHEMA_INVALID/)}
 assert.throws(()=>v.parse('```json {}'),/AI_SCHEMA_INVALID/);
 assert.throws(()=>v.decision({intent:'change',projectId:operation,rationale:'x',question:null},operation));
 assert.throws(()=>v.decision({intent:'plan',projectId:'other',rationale:'x',question:null},operation));
 assert.throws(()=>v.review({ok:'true',issues:[],revisedPlan:null}));
 assert.throws(()=>v.review({ok:true,issues:[{severity:'error',message:'bad'}],revisedPlan:null}));
 assert.throws(()=>v.review({ok:true,issues:[],revisedPlan:plan}));
});
test('Default locked expense gate and missing credential make zero provider calls',async t=>{
 const f=await fixture(t,{authorized:async()=>false});assert.equal((await f.request()).status,403);assert.equal(f.calls(),0);assert.equal(f.db.prepare('SELECT count(*) n FROM calls').get().n,0);
 const g=await fixture(t);assert.equal((await g.request('coordinator',validRequest,'')).status,401);assert.equal(g.calls(),0);
});
test('Three-stage success records redacted evidence and lifetime budget blocks all further calls',async t=>{
 const f=await fixture(t);for(const stage of ['coordinator','planner','reviewer'])assert.equal((await f.request(stage)).status,200);
 assert.equal(f.calls(),3);const r=await f.request();assert.equal(r.status,502);assert.equal((await r.json()).error.message,'AI_BUDGET_EXHAUSTED');assert.equal(f.calls(),3);
 const rows=f.db.prepare('SELECT * FROM calls').all();assert.ok(rows.every(r=>r.status==='success'&&r.provider_request_id==='mock-provider-request'));assert.doesNotMatch(JSON.stringify(rows),/mock-not-a-real-key|Return JSON/);
});
test('Concurrent replay is blocked before provider I/O and out-of-order calls consume no budget',async t=>{
 const f=await fixture(t);assert.equal((await f.request('planner')).status,502);assert.equal(f.calls(),0);
 const results=await Promise.all([f.request(),f.request()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,502]);assert.equal(f.calls(),1);
});
test('Reservations survive restart and crashes; automatic retries cannot buy another invocation',async t=>{
 const dir=await mkdtemp(tmpdir()+'/g3-ai-restart-');t.after(()=>rm(dir,{recursive:true,force:true}));let db=ledger(dir+'/budget.sqlite');reserve(db,operation,'coordinator','{}');db.close();db=ledger(dir+'/budget.sqlite');assert.throws(()=>reserve(db,operation,'coordinator','{}'),/AI_REPLAY_OR_STAGE_ORDER/);assert.throws(()=>reserve(db,operation,'planner','{}'),/AI_REPLAY_OR_STAGE_ORDER/);assert.equal(db.prepare('SELECT count(*) n FROM calls').get().n,1);db.close();
});
test('Provider unavailability is bounded, scrubbed and never retried',async t=>{
 let calls=0;const f=await fixture(t,{upstream:async()=>{calls++;return new Response(JSON.stringify({error:{message:'secret-provider-message'}}),{status:503})}});
 const r=await f.request();assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret-provider/);assert.equal((await f.request()).status,502);assert.equal(calls,1);
});
test('Real HTTP provider timeout consumes reservation with no retry',async t=>{
 const slow=(await import('node:http')).createServer((req,res)=>{req.resume();setTimeout(()=>res.end('{}'),100)});await new Promise(r=>slow.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>slow.close(r)));
 let calls=0;const f=await fixture(t,{timeoutMs:10,upstream:async(url,options)=>{calls++;return fetch(`http://127.0.0.1:${slow.address().port}`,options)}});
 const start=Date.now(),r=await f.request();assert.equal(r.status,502);assert.ok(Date.now()-start<1000);assert.equal((await f.request()).status,502);assert.equal(calls,1);assert.notEqual(f.db.prepare('SELECT status FROM calls').get().status,'success');
});
test('Invalid provider response is rejected; oversized/token/tool/model changes never call provider',async t=>{
 const f=await fixture(t);for(const patch of [{max_tokens:1201},{model:'other'},{tools:[{}]},{messages:[{role:'user',content:'x'.repeat(12001)}]}]){assert.ok((await f.request('coordinator',{...validRequest,...patch})).status>=400)}assert.equal(f.calls(),0);
 const g=await fixture(t,{upstream:async()=>new Response('{malformed')});assert.equal((await g.request()).status,502);assert.notEqual(g.db.prepare('SELECT status FROM calls').get().status,'success');
});
test('Stale or unauthorized operation is rejected before any paid reservation',async t=>{
 const f=await fixture(t,{verifyOperation:async()=>{throw new Error('AI_OPERATION_INVALID')}});assert.equal((await f.request()).status,502);assert.equal(f.calls(),0);assert.equal(f.db.prepare('SELECT count(*) n FROM calls').get().n,0);
});
