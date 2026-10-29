import {chromium} from '../../apps/backend/node_modules/playwright/index.mjs';
import {root,secrets,database} from './runtime.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const{default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});
const{passwordHash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');
const browser=await chromium.launch();const page=await browser.newPage();const report={checks:[]};
try{
 const email='g3-retry-'+Date.now()+'@example.invalid';await pool.query("INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'SYNTHETISCH Retry','human',$2)",[email,await passwordHash(secrets.G3_HUMAN_PASSWORD)]);
 await page.goto('http://localhost:25173');await page.getByLabel('E-Mail').fill(email);await page.getByLabel('Passwort').fill(secrets.G3_HUMAN_PASSWORD);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'}).waitFor();
 await page.goto('http://localhost:25173/projects/new');const brief='SYNTHETISCH Ambiguous '+Date.now()+'. Identische Eingabe nach Verbindungsabbruch.';await page.locator('textarea').first().fill(brief);
 let originalKey,committedId;await page.route('**/api/v1/projects',async route=>{if(route.request().method()!=='POST')return route.continue();originalKey=route.request().headers()['idempotency-key'];const r=await route.fetch();assert.equal(r.status(),201);committedId=(await r.json()).id;await route.abort('failed')},{times:1});
 await page.locator('button[type=submit]').click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/ursprüngliche Idempotenzschlüssel/);report.checks.push({name:'Ambiguous real committed write shows explicit error',result:'PASS'});
 await page.reload();await page.locator('textarea').first().fill(brief);let replayKey;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v1/projects')replayKey=r.headers()['idempotency-key']});await page.locator('button[type=submit]').click();await page.waitForURL(/\/projects\/[^/]+\/board/);assert.equal(replayKey,originalKey);assert.ok(page.url().includes(committedId));
 const count=(await pool.query("SELECT count(*)::int n FROM projects WHERE name=$1",[brief.split('.')[0]])).rows[0].n;assert.equal(count,1);report.checks.push({name:'Reload and explicit retry reuse original key and recover same project exactly once',result:'PASS'});
 // An actual backend denial remains an error, with no demo fallback.
 await page.goto('http://localhost:25173/projects/00000000-0000-4000-8000-000000000000/workspace');await page.getByRole('alert').waitFor();assert.equal(await page.getByTestId('plan-version-id').count(),0);report.checks.push({name:'Denied project read never falls back to demo data',result:'PASS'});
 report.result='PASS';console.log(JSON.stringify(report));
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e);process.exitCode=1}finally{await writeFile(root+'/docs/integration-g3/evidence/browser-retry.json',JSON.stringify(report,null,2));await browser.close();await pool.end()}
