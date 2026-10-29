import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
// All responses in this file are controlled HTTP fixtures. They are NOT PostgreSQL evidence.
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const V='33333333-3333-4333-8333-333333333333',T='44444444-4444-4444-8444-444444444444';
const now='2026-10-29T08:00:00Z';
const user={id:'55555555-5555-4555-8555-555555555555',display_name:'G4 HTTP fixture'};
const baseProject=(id:string,name:string)=>({id,name,description:'Unchanged project content\nSecond line',status:'active',version:1,published_plan_id:V,created_at:now,updated_at:now});
const taskBase={id:T,project_id:A,phase_id:'phase',source_plan_id:V,source_key:'task',title:'Backend-Aufgabe',description:'Persisted description',status:'todo',priority:'urgent',version:7,due_date:null,assignee_id:null};
const planBase={id:V,project_id:A,number:1,base_project_version:1,status:'published',content_hash:'a'.repeat(64),created_at:now,snapshot:{phases:[{key:'phase',name:'Planung',description:''}],tasks:[{key:'task',phase_key:'phase',title:'Backend-Aufgabe',description:'Persisted description',priority:'urgent',depends_on:[],due_date:null,assignee_id:null}]}};
const error=(status:number,code:string)=>({status,json:{error:{code,message:'Fixture rejection',request_id:'fixture-'+status}}});
async function fixture(page:Page,hook?:(r:Route,path:string)=>Promise<boolean>){
 const projects=[baseProject(A,'Projekt Alpha'),baseProject(B,'Projekt Beta')],task={...taskBase};
 const calls:Array<{method:string;path:string;body:unknown;key:string|undefined;at:number}>=[],unexpected:string[]=[];
 await page.route('**/api/v1/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
   calls.push({method,path,body:method==='GET'?null:req.postDataJSON(),key:req.headers()['idempotency-key'],at:Date.now()});
   if(hook&&await hook(route,path))return;
   if(path.endsWith('/auth/session'))return route.fulfill({json:user});
   if(path.endsWith('/auth/csrf'))return route.fulfill({json:{csrf_token:'fixture-csrf'}});
   if(path.endsWith('/auth/logout'))return route.fulfill({status:204});
   if(path==='/api/v1/projects'){
     if(method==='POST'){const body=req.postDataJSON();expect(Object.keys(body).sort()).toEqual(['description','name']);const p={...baseProject(crypto.randomUUID(),body.name),description:body.description,status:'draft',published_plan_id:null};projects.push(p as typeof projects[number]);return route.fulfill({status:201,json:p});}
     return route.fulfill({json:{items:projects,limit:100,offset:0}});
   }
   const pid=path.split('/')[4],project=projects.find(p=>p.id===pid);
   if(path.endsWith('/status')&&method==='PATCH'){
     expect(req.headers()['x-csrf-token']).toBe('fixture-csrf');const body=req.postDataJSON();expect(Object.keys(body).sort()).toEqual(['status','version']);
     if(body.version!==task.version)return route.fulfill(error(409,'stale_task_version'));
     task.status=body.status;task.version++;return route.fulfill({json:task});
   }
   if(method!=='GET'){unexpected.push(path);return route.fulfill(error(400,'unexpected_write'));}
   // G6 adds read-only project-scoped collections. These are controlled fixtures,
   // never real members or persisted relations.
   if(path.endsWith('/members'))return route.fulfill({json:{items:[],limit:100,offset:0}});
   if(path.endsWith('/dependencies'))return route.fulfill({json:{items:[]}});
   if(path.endsWith('/activity'))return route.fulfill({json:{items:[{id:'event-'+pid,project_id:pid,type:'project.created',created_at:now}],limit:100,offset:0}});
   if(path.endsWith('/operations'))return route.fulfill({json:{items:[{id:'job-'+pid,project_id:pid,kind:'publish',status:'succeeded',error:null,result:{task_count:1},created_at:now}],limit:100,offset:0}});
   if(path.endsWith('/approvals'))return route.fulfill({json:{items:[],revocations:[]}});
   if(path.endsWith('/tasks'))return route.fulfill({json:{items:pid===A?[task]:[],limit:100,offset:0}});
   if(path.endsWith('/plans'))return route.fulfill({json:{items:pid===A?[planBase]:[],limit:100,offset:0}});
   if(path.endsWith('/plans/'+V))return route.fulfill({json:planBase});
   if(project&&path==='/api/v1/projects/'+pid)return route.fulfill({json:project});
   unexpected.push(path);return route.fulfill(error(404,'fixture_missing'));
 });
 return {calls,projects,task,unexpected};
}
async function shot(page:Page,name:string){await page.screenshot({path:'qa-evidence/screenshots/g4-'+name+'.png',fullPage:true});}
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Hauptmen\u00fc'}).getByRole('link',{name,exact:true});
test.beforeAll(async()=>mkdir('qa-evidence/screenshots',{recursive:true}));

test('rapid navigation reuses reads, keeps one application and does not poll terminal operations',async({page})=>{
 const state=await fixture(page);await page.goto('/');await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 for(let round=0;round<2;round++){
   await nav(page,'Projektaufgaben').click();await expect(page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'})).toBeVisible();
   await nav(page,'AI Planungsstudio').click();await expect(page.getByText('Fixierter Snapshot v1')).toBeVisible();
   await nav(page,'Aktivit\u00e4t & Betrieb').click();await expect(page.getByRole('heading',{name:'Projektereignisse \u00b7 Backend'})).toBeVisible();
   await nav(page,'Dashboard').click();await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 }
 const projects=state.calls.filter(c=>c.path==='/api/v1/projects');expect(projects).toHaveLength(1);
 expect(state.calls.filter(c=>c.path==='/api/v1/projects/'+A+'/tasks').length).toBeLessThanOrEqual(2);
 expect(state.calls.filter(c=>c.path==='/api/v1/projects/'+B+'/activity')).toHaveLength(0);
 expect(state.calls.filter(c=>c.method!=='GET')).toHaveLength(0);expect(state.unexpected).toEqual([]);
 await shot(page,'live-dashboard-fixture');await nav(page,'AI Planungsstudio').click();await expect(page.getByText('Fixierter Snapshot v1')).toBeVisible();
 const before=state.calls.length;await page.waitForTimeout(5300);expect(state.calls.length).toBe(before);
 await writeFile('qa-evidence/g4-request-trace.json',JSON.stringify({kind:'controlled-http-fixture',calls:state.calls},null,2));
});

test('reload during 429 retains route and recovers without showing the login form',async({page})=>{
 const deadline=Date.now()+4000;const state=await fixture(page,async(route,path)=>{
  if(path.endsWith('/tasks')&&Date.now()<deadline){await route.fulfill({...error(429,'FST_ERR_RATE_LIMIT'),headers:{'Retry-After':String(Math.ceil((deadline-Date.now())/1000))}});return true;}return false;
 });
 await page.goto('/projects/'+A+'/board');await expect(page.getByTestId('rate-limit-notice')).toBeVisible();await expect(nav(page,'Dashboard')).toBeVisible();await shot(page,'rate-limit-fixture');
 await page.reload();await expect(page.getByLabel('Passwort')).toHaveCount(0);await expect(page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'})).toBeVisible();expect(page.url()).toContain('/projects/'+A+'/board');
 await expect(page.getByTestId('rate-limit-notice')).toHaveCount(0);expect(state.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
});

test('429 during session bootstrap is recoverable, not authentication loss',async({page})=>{
 let first=true;const state=await fixture(page,async(route,path)=>{if(path.endsWith('/auth/session')&&first){first=false;await route.fulfill({...error(429,'FST_ERR_RATE_LIMIT'),headers:{'Retry-After':'1'}});return true;}return false;});
 await page.goto('/projects/'+A+'/board');await expect(page.getByTestId('rate-limit-notice')).toBeVisible();await expect(page.getByLabel('Passwort')).toHaveCount(0);await expect(page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'})).toBeVisible();expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(0);
});

test('a stale project read is cancelled and cannot replace the newly selected project',async({page})=>{
 let release!:()=>void,blocked=false;const state=await fixture(page,async(route,path)=>{
   if(path==='/api/v1/projects/'+A+'/tasks'&&!blocked){blocked=true;await new Promise<void>(r=>{release=r});await route.fulfill({json:{items:[taskBase],limit:100,offset:0}}).catch(()=>undefined);return true;}return false;
 });
 await page.goto('/projects/'+A+'/board');await expect(page.getByLabel('Projekt ausw\u00e4hlen')).toBeEnabled();await expect.poll(()=>blocked).toBe(true);
 await page.getByLabel('Projekt ausw\u00e4hlen').selectOption(B);release();await expect(page).toHaveURL(new RegExp('/projects/'+B+'/board'));await expect(page.getByRole('heading',{name:'Projekt-Workspace'})).toBeVisible();await expect(page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'})).toHaveCount(0);expect(state.unexpected).toEqual([]);
});

test('missing Retry-After exposes manual recovery and never invents a wait duration',async({page})=>{
 let limited=true;const state=await fixture(page,async(route,path)=>{if(path.endsWith('/tasks')&&limited){await route.fulfill(error(429,'FST_ERR_RATE_LIMIT'));return true;}return false;});
 await page.goto('/projects/'+A+'/board');await expect(page.getByTestId('rate-limit-notice')).toContainText('keine lesbare Wartezeit');await expect(nav(page,'Dashboard')).toBeVisible();const count=state.calls.length;await page.waitForTimeout(500);expect(state.calls.length).toBe(count);
 limited=false;await page.getByTestId('rate-limit-notice').getByRole('button',{name:'Lesedaten erneut laden'}).click();await expect(page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'})).toBeVisible();
});

test('live status-only editor preserves version checks and activity is project-scoped',async({page})=>{
 const state=await fixture(page);await page.goto('/projects/'+A+'/board');await page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).not.toContainText('Lokale Demo');await expect(dialog.getByLabel('Titel')).toHaveAttribute('readonly');await expect(dialog.getByLabel('Priorit\u00e4t')).toBeDisabled();await shot(page,'live-task-panel-fixture');
 state.task.version=8;await dialog.getByLabel('Status',{exact:true}).selectOption('done');await dialog.getByRole('button',{name:'Status im Backend speichern'}).click();await expect(dialog.getByRole('alert')).toContainText('Versionskonflikt');expect(state.task.status).toBe('todo');
 await page.reload();await page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'}).click();await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('done');await page.getByRole('button',{name:'Status im Backend speichern'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.task.status).toBe('done');
 expect(state.calls.filter(c=>c.method==='PATCH').map(c=>c.body)).toEqual([{version:7,status:'done'},{version:8,status:'done'}]);
 await nav(page,'Aktivit\u00e4t & Betrieb').click();await expect(page.getByRole('heading',{name:'Projektereignisse \u00b7 Backend'})).toBeVisible();await expect(page.locator('main')).not.toContainText('Demo-Arbeitsspeicher');await expect(page.locator('main')).toContainText('event-'+A);await shot(page,'live-activity-fixture');
 await page.getByLabel('Projekt ausw\u00e4hlen').selectOption(B);await expect(page.locator('main')).toContainText('event-'+B);await expect(page.locator('main')).not.toContainText('event-'+A);
 await nav(page,'Einstellungen').click();await expect(page.locator('main')).toContainText('PostgreSQL');await expect(page.locator('main')).not.toContainText('Nicht persistent');expect(state.unexpected).toEqual([]);
});

test('a throttled status write is never automatically repeated and explicit retry retains its key',async({page})=>{
 let first=true;const state=await fixture(page,async(route,path)=>{if(path.endsWith('/status')&&first){first=false;await route.fulfill({...error(429,'FST_ERR_RATE_LIMIT'),headers:{'Retry-After':'1'}});return true;}return false;});
 await page.goto('/projects/'+A+'/board');await page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Backend-Aufgabe'}).click();await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('done');await page.getByRole('button',{name:'Status im Backend speichern'}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Zu viele Anfragen');await page.waitForTimeout(1200);expect(state.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
 await page.getByRole('button',{name:'Status im Backend speichern'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);const writes=state.calls.filter(c=>c.method==='PATCH');expect(writes).toHaveLength(2);expect(writes[1].key).toBe(writes[0].key);
});

test('authorization 403 is not treated as session loss or replaced with demo data',async({page})=>{
 await fixture(page,async(route,path)=>{if(path.endsWith('/tasks')){await route.fulfill(error(403,'forbidden'));return true;}return false;});await page.goto('/projects/'+A+'/board');await expect(page.getByRole('alert')).toContainText('Zugriff verweigert');await expect(nav(page,'Dashboard')).toBeVisible();await expect(page.getByLabel('Passwort')).toHaveCount(0);await expect(page.getByRole('button',{name:/Aufgabe \u00f6ffnen:/})).toHaveCount(0);
});

test('multilingual content remains unchanged through create, reload, selector and status filters (HTTP fixture)',async({page})=>{
 const state=await fixture(page),name='\u041f\u0440\u043e\u0435\u043a\u0442 \u00ab\u041c\u043e\u0441\u0442\u00bb / Br\u00fccke / Bridge',description='\u0421\u0442\u0440\u043e\u043a\u0430 1: \u0451, \u0439; API & \u201cquotes\u201d.\nZweite Zeile: Gr\u00f6\u00dfe.\nThird line: e\u0301!';
 await page.goto('/projects/new');await page.getByLabel('Projektname',{exact:true}).fill(name);await page.getByLabel('Was m\u00f6chtest du erreichen?').fill(description);await page.getByRole('button',{name:'Projekt im Backend erstellen'}).dblclick();
 await expect(page).toHaveURL(/\/board$/);expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(1);const id=page.url().split('/')[4];await expect(page.getByTestId('project-description')).toHaveText(description);
 await page.reload();await expect(page.getByTestId('project-description')).toHaveText(description);expect(state.projects.find(p=>p.id===id)?.name).toBe(name);await expect(page.getByLabel('Projekt ausw\u00e4hlen')).toHaveValue(id);await expect(nav(page,'Dashboard')).toBeVisible();await shot(page,'multilingual-fixture');
 await page.getByLabel('Statusfilter').selectOption('blocked');await expect(page).toHaveURL(new RegExp(id));expect(state.calls.filter(c=>c.method==='POST')).toHaveLength(1);expect(state.unexpected).toEqual([]);
});
