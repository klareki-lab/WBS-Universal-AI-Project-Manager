import {chromium} from '../../apps/backend/node_modules/playwright/index.mjs';
import {root,secrets,database} from './runtime.mjs';
import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const{default:pg}=await import(root+'/apps/backend/node_modules/pg/lib/index.js');const pool=new pg.Pool({connectionString:database});const{passwordHash}=await import(root+'/apps/backend/dist/apps/backend/src/security.js');const browser=await chromium.launch();const page=await browser.newPage();const report={checks:[]};
const compose=action=>{const r=spawnSync('docker',['compose','--env-file','.g3/runtime.env','-f','infra/integration-g3/compose.yaml',action,'postgres'],{cwd:root,encoding:'utf8'});assert.equal(r.status,0)};
let stopped=false;
try{
 const email='g3-outage-'+Date.now()+'@example.invalid';await pool.query("INSERT INTO users(email,display_name,kind,password_hash) VALUES($1,'SYNTHETISCH Outage','human',$2)",[email,await passwordHash(secrets.G3_HUMAN_PASSWORD)]);await pool.end();
 await page.goto('http://localhost:25173');await page.getByLabel('E-Mail').fill(email);await page.getByLabel('Passwort').fill(secrets.G3_HUMAN_PASSWORD);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'}).waitFor();
 await page.goto('http://localhost:25173/projects/new');await page.locator('textarea').first().fill('SYNTHETISCH DB-Ausfall '+Date.now()+'. Isolierter Wiederanlauftest.');await page.locator('button[type=submit]').click();await page.waitForURL(/\/projects\/[^/]+\/board/);const pid=page.url().split('/')[4];
 // Only stop the dedicated G3 PostgreSQL service, never an existing installation.
 compose('stop');stopped=true;
 const ready=await fetch('http://localhost:23081/ready');assert.equal(ready.status,503);
 await page.goto(`http://localhost:25173/projects/${pid}/workspace`);await page.getByRole('alert').waitFor();assert.equal(await page.getByTestId('plan-version-id').count(),0);report.checks.push({name:'Actual G3 PostgreSQL outage gives readiness 503 and explicit React error without demo fallback',result:'PASS'});
 compose('start');stopped=false;for(let i=0;i<30;i++){if((await fetch('http://localhost:23081/ready')).status===200)break;await new Promise(r=>setTimeout(r,1000))}
 await page.reload();await page.getByLabel('Planungsziel').waitFor();report.checks.push({name:'Same running backend recovers after G3 database restart; human session is restored',result:'PASS'});report.result='PASS';console.log(JSON.stringify(report));
}catch(e){report.result='FAIL';report.error=e.stack;console.error(e);process.exitCode=1}finally{if(stopped)compose('start');await browser.close();await writeFile(root+'/docs/integration-g3/evidence/browser-outage.json',JSON.stringify(report,null,2))}
