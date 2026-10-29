import {chromium} from '../../../apps/backend/node_modules/playwright/index.mjs';
import {root,secrets,database} from '../runtime.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const missing=process.argv.includes('--expect-missing-credential');
const evidence={profile:'G3 separate AI profile',realAI:'NOT VERIFIED',synthetic:true,startedAt:new Date().toISOString(),checks:[],http:[]};
const cookie=await readFile(root+'/.g3/n8n-cookie','utf8');
const credentials=await fetch('http://localhost:25682/rest/credentials',{headers:{cookie}}).then(r=>r.json());
evidence.openAICredentialPresent=credentials.data.some(c=>c.type==='openAiApi'&&!/mock/i.test(c.name));
if(missing&&evidence.openAICredentialPresent)throw new Error('Missing-credential test requires no real credential');
if(!missing){
 assert.equal(evidence.openAICredentialPresent,true,'Owner must supply isolated credential first');
 const a=JSON.parse(await readFile(root+'/.g3/ai-expense-authorization.json','utf8'));assert.equal(a.authorized,true);assert.equal(a.maxUsd,0.05);
 const db=new DatabaseSync(root+'/.g3/ai-budget.sqlite',{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM calls').get().n,0,'No automatic budget reset permitted');db.close();
}
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const check=name=>{evidence.checks.push({name,result:'PASS'});console.log('PASS',name)};
page.on('response',r=>{if(r.url().startsWith('http://localhost:23081'))evidence.http.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),requestId:r.headers()['x-request-id']})});
try{
 const email='g3-ai-'+Date.now()+'@example.invalid';const {passwordHash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');await pool.query("INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'SYNTHETISCH G3 AI Acceptance','human',$2)",[email,await passwordHash(secrets.G3_HUMAN_PASSWORD)]);
 await page.goto('http://localhost:25173');await page.getByLabel('E-Mail').fill(email);await page.getByLabel('Passwort').fill(secrets.G3_HUMAN_PASSWORD);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'}).waitFor();
 await page.goto('http://localhost:25173/projects/new');await page.locator('textarea').first().fill('SYNTHETISCH G3 AI '+Date.now()+'. Ein internes Testprojekt ohne Kundendaten.');await page.locator('button[type=submit]').click();await page.waitForURL(/\/projects\/[^/]+\/board/);
 const projectId=page.url().split('/')[4];evidence.projectId=projectId;check('Fresh project created through actual React by synthetic human session');
 await page.goto(`http://localhost:25173/projects/${projectId}/workspace`);await page.getByLabel('Planungsziel').fill('SYNTHETISCH: Plane einen internen Workshop zu barrierefreien Formularen. Zwei Phasen, drei Aufgaben, messbare Abnahmekriterien. Keine echten Personen oder Kundendaten.');await page.getByRole('button',{name:'Planung anfordern',exact:true}).click();
 let op;for(let i=0;i<90;i++){op=(await pool.query("SELECT * FROM operation_jobs WHERE project_id=$1 AND kind='planning' ORDER BY created_at DESC LIMIT 1",[projectId])).rows[0];if(['failed','succeeded'].includes(op?.status))break;await new Promise(r=>setTimeout(r,1000))}
 assert.ok(op);evidence.operation={id:op.id,requestId:op.request_id,contextHash:op.context_hash,input:op.input,status:op.status,attempts:op.attempts};check('Original backend operation, request context and immutable base persisted');
 if(missing){
  assert.equal(op.status,'failed');assert.equal(op.attempts,1);assert.equal((await pool.query('SELECT count(*)::int n FROM plan_versions WHERE project_id=$1',[projectId])).rows[0].n,0);
  await page.reload();await page.getByText(/planning: failed/).waitFor();assert.equal(await page.getByTestId('plan-version-id').count(),0);await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-missing-credential.png',fullPage:true});
  check('Missing native OpenAI credential fails original operation once; no draft or fixture fallback');
 }else{
  assert.equal(op.status,'succeeded');await page.getByTestId('plan-version-id').waitFor({timeout:15000});
  const planId=await page.getByTestId('plan-version-id').textContent();const plan=(await pool.query('SELECT * FROM plan_versions WHERE id=$1',[planId])).rows[0];assert.equal(plan.origin_operation_id,op.id);assert.equal(plan.base_project_version,op.input.base_project_version);assert.ok(Number.isInteger(plan.number));evidence.plan={id:plan.id,number:plan.number,contentHash:plan.content_hash,originOperationId:plan.origin_operation_id,baseProjectVersion:plan.base_project_version};
  assert.ok((await page.locator('body').textContent()).includes(plan.content_hash));await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-draft.png',fullPage:true});check('Actual React displays exact generated immutable version and hash');
  const service=await fetch(`http://localhost:23081/api/v1/projects/${projectId}/plans/${planId}/approvals`,{method:'POST',headers:{authorization:'Bearer '+secrets.G3_BACKEND_TOKEN,'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({content_hash:plan.content_hash,decision:'approved'})});assert.equal(service.status,403);check('Service/AI cannot approve even using direct backend API');
  await page.getByRole('button',{name:'Review einreichen',exact:true}).click();await page.getByRole('button',{name:'Version freigeben',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Version freigeben',exact:true}).isDisabled(),true);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Version freigeben',exact:true}).click();await page.getByRole('button',{name:'Plan veröffentlichen',exact:true}).waitFor();await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-approved.png',fullPage:true});evidence.approval=(await pool.query('SELECT a.id,a.plan_version_id,a.content_hash,a.decision,a.user_id,u.kind,a.created_at FROM approvals a JOIN users u ON u.id=a.user_id WHERE a.plan_version_id=$1',[planId])).rows[0];assert.equal(evidence.approval.kind,'human');assert.equal(evidence.approval.content_hash,plan.content_hash);assert.equal(evidence.approval.decision,'approved');check('Synthetic human explicitly confirms exact displayed version/hash');
  await page.getByRole('button',{name:'Plan veröffentlichen',exact:true}).click();await page.getByText('Plan veröffentlicht. Aufgaben sind im Kanban gespeichert.',{exact:true}).waitFor();
  const tasks=(await pool.query('SELECT id,title,status FROM tasks WHERE project_id=$1 ORDER BY created_at,id',[projectId])).rows;assert.equal(tasks.length,plan.snapshot.tasks.length);evidence.tasks=tasks;
  await page.goto(`http://localhost:25173/projects/${projectId}/board`);await page.getByRole('button',{name:'Aufgabe öffnen: '+tasks[0].title,exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Aufgabe öffnen: '+tasks[0].title,exact:true}).waitFor();await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-kanban.png',fullPage:true});check('Published tasks persist in PostgreSQL and Kanban after reload');
  await page.goto('http://localhost:25173');await page.getByText(tasks[0].title,{exact:true}).first().waitFor();await page.goto('http://localhost:25173/activity');await page.getByText('plan.published',{exact:true}).first().waitFor();check('Dashboard and activity reflect publication');
  evidence.events=(await pool.query('SELECT type,entity_id,actor_id,request_id,created_at FROM activity_events WHERE project_id=$1 ORDER BY created_at,id',[projectId])).rows;
  const db=new DatabaseSync(root+'/.g3/ai-budget.sqlite',{readOnly:true});evidence.providerCalls=db.prepare('SELECT * FROM calls WHERE operation_id=? ORDER BY id').all(op.id);db.close();assert.equal(evidence.providerCalls.length,3);assert.ok(evidence.providerCalls.every(c=>c.status==='success'&&c.provider_request_id&&c.completion_id));
  evidence.realAI='VERIFIED';check('Three actual provider request IDs, completion IDs and usage records linked to original operation');
 }
 evidence.result='PASS';
}catch(e){evidence.result='FAIL';evidence.failure=e.message;process.exitCode=1;console.error(e.message)}
finally{await writeFile(root+'/docs/integration-g3/evidence/'+(missing?'ai-missing-credential.json':'ai-browser.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();await pool.end()}
