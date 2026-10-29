import {describe,it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestServer,type TestHarness} from './helpers.ts';
describe('Reconciled /invoke facade uses the authenticated SDK catalog',()=>{
 let h:TestHarness;
 before(async()=>{h=await startTestServer()});after(async()=>h.stop());
 const invoke=async(tool:string,args:unknown,token='test-token',user='user_demo')=>fetch(h.baseUrl+'/invoke/'+tool,{method:'POST',headers:{authorization:'Bearer '+token,'x-on-behalf-of':user,'content-type':'application/json'},body:JSON.stringify({arguments:args})});
 it('rejects unauthenticated invocation before tool dispatch',async()=>{assert.equal((await invoke('list_projects',{},'wrong')).status,401)});
 it('retains project isolation and wrapped read response',async()=>{
   const ok=await invoke('get_project',{id:'prj_demo'});assert.equal(ok.status,200);assert.equal((await ok.json()).result.id,'prj_demo');
   const denied=await invoke('get_project',{id:'prj_demo'},'test-token','user_outsider');assert.equal(denied.status,422);assert.equal((await denied.json()).error.code,'forbidden');
 });
 it('enforces required scoped IDs and immutable base at the tool schema',async()=>{
   assert.equal((await invoke('get_plan_version',{planVersionId:'bare'})).status,422);
   assert.equal((await invoke('create_plan_draft',{projectId:'prj_demo',idempotencyKey:'facade-no-base',plan:{}})).status,422);
 });
});
