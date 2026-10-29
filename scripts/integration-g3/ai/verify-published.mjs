import {chromium} from '../../../apps/backend/node_modules/playwright/index.mjs';
import {root,secrets,database} from '../runtime.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const file=root+'/docs/integration-g3/evidence/ai-browser.json', evidence=JSON.parse(await readFile(file,'utf8'));
const {default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
try{
 const {rows}=await pool.query('SELECT u.email FROM users u JOIN operation_jobs o ON o.created_by=u.id WHERE o.id=$1',[evidence.operation.id]);
 await page.goto('http://localhost:25174');await page.getByLabel('E-Mail').fill(rows[0].email);await page.getByLabel('Passwort').fill(secrets.G3_HUMAN_PASSWORD);await page.getByRole('button',{name:'Anmelden',exact:true}).click();
 await page.getByText('Offene Aufgaben',{exact:true}).waitFor();await page.getByText('plan.published',{exact:true}).first().waitFor();
 const text=await page.locator('body').innerText();assert.match(text,/Offene Aufgaben\s+3/);await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-dashboard.png',fullPage:true});
 await page.goto('http://localhost:25174/activity');await page.getByText('plan.published',{exact:true}).first().waitFor();await page.screenshot({path:root+'/docs/integration-g3/evidence/ai-activity.png',fullPage:true});
 evidence.checks.push({name:'Dashboard shows three open tasks and publication; activity history displays publication',result:'PASS',verification:'Targeted follow-up; no model calls'});
 evidence.events=(await pool.query('SELECT type,entity_id,actor_id,request_id,created_at FROM activity_events WHERE project_id=$1 ORDER BY created_at,id',[evidence.projectId])).rows;
 const db=(await import('node:sqlite')).DatabaseSync;const ledger=new db(root+'/.g3/ai-budget.sqlite',{readOnly:true});evidence.providerCalls=ledger.prepare('SELECT * FROM calls WHERE operation_id=? ORDER BY id').all(evidence.operation.id);ledger.close();
 assert.equal(evidence.providerCalls.length,3);assert.ok(evidence.providerCalls.every(c=>c.status==='success'&&c.provider_request_id&&c.completion_id));evidence.providerUsage=evidence.providerCalls.map(c=>({stage:c.stage,...JSON.parse(c.usage)}));evidence.estimatedUsd=evidence.providerUsage.reduce((sum,u)=>sum+(u.prompt_tokens*.4+u.completion_tokens*1.6)/1e6,0);assert.ok(evidence.estimatedUsd<=.05);
 evidence.initialRunnerFailure=evidence.failure;delete evidence.failure;evidence.realAI='VERIFIED';evidence.result='PASS';await writeFile(file,JSON.stringify(evidence,null,2)+'\n');console.log('PASS dashboard and activity targeted follow-up, no provider calls');
}finally{await browser.close();await pool.end()}
