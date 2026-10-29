import {chromium} from '../../apps/backend/node_modules/playwright/index.mjs';
import {root,secrets,database} from './runtime.mjs';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const{default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});const{passwordHash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');const browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();const report={checks:[]};
try{
 const email='g3-errors-'+Date.now()+'@example.invalid';await pool.query("INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'SYNTHETISCH Conflicts','human',$2)",[email,await passwordHash(secrets.G3_HUMAN_PASSWORD)]);
 await page.goto('http://localhost:25173');await page.getByLabel('E-Mail').fill(email);await page.getByLabel('Passwort').fill(secrets.G3_HUMAN_PASSWORD);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'}).waitFor();
 await page.goto('http://localhost:25173/projects/new');await page.locator('textarea').first().fill('SYNTHETISCH Konflikte '+Date.now()+'. Isolierte Chromium-Fehlerszenarien.');await page.locator('button[type=submit]').click();await page.waitForURL(/\/projects\/[^/]+\/board/);const pid=page.url().split('/')[4];await page.goto(`http://localhost:25173/projects/${pid}/workspace`);await page.getByLabel('Aufgabentitel').fill('SYNTHETISCH stale proposal');
 const base='http://localhost:23081/api/v1/projects/'+pid;
 await page.route('**/api/v1/projects/'+pid+'/plans',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const token=(await (await context.request.get('http://localhost:23081/api/v1/auth/csrf')).json()).csrf_token;
  const project=await (await context.request.get(base)).json();
  const mutation=await context.request.patch(base,{headers:{'x-csrf-token':token,'idempotency-key':randomUUID()},data:{version:project.version,description:'SYNTHETISCH concurrent change'}});assert.equal(mutation.status(),200);await route.continue();
 },{times:1});
 const staleResponse=page.waitForResponse(r=>r.url()===base+'/plans'&&r.request().method()==='POST');await page.getByRole('button',{name:'Neue Entwurfsversion',exact:true}).click();assert.equal((await staleResponse).status(),409);await page.getByRole('alert').waitFor();assert.equal(await page.getByTestId('plan-version-id').count(),0);report.checks.push({name:'Actual concurrent project change causes a stale draft conflict displayed in React',result:'PASS'});
 const statuses=await page.evaluate(async(id)=>{const {api,request,session}=await import('/src/live/client.ts');await session();const p=await api.project(id);return Promise.all(['A','B'].map(async suffix=>{try{await request('/api/v1/projects/'+id,'PATCH',{version:p.version,description:'SYNTHETISCH browser '+suffix});return 200}catch(e){return e.status}}))},pid);assert.deepEqual(statuses.sort(),[200,409]);report.checks.push({name:'Concurrent mutations from Chromium: one commit and one explicit 409',result:'PASS'});
 await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)",[email]);await page.reload();await page.getByRole('button',{name:'Anmelden',exact:true}).waitFor();assert.equal(await page.getByTestId('plan-version-id').count(),0);report.checks.push({name:'Actual expired cookie session returns Chromium to the login gate',result:'PASS'});report.result='PASS';console.log(JSON.stringify(report));
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser.close();await pool.end();await writeFile(root+'/docs/integration-g3/evidence/browser-errors.json',JSON.stringify(report,null,2))}
