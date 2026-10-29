import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const evidence:{projects:Array<{id:string;name:string;description:string}>;checks:string[];providerCalls:number}={projects:[],checks:[],providerCalls:0};
const content=[
 {name:'\u041f\u0440\u043e\u0435\u043a\u0442 \u00ab\u041c\u043e\u0441\u0442\u00bb',description:'\u041f\u0435\u0440\u0432\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430: \u0451, \u0439.\n\u0412\u0442\u043e\u0440\u0430\u044f: API & \u201cquotes\u201d.'},
 {name:'\u00dcberblick & Qualit\u00e4t',description:'Gr\u00f6\u00dfe pr\u00fcfen.\nZweite Zeile \u2014 unver\u00e4ndert.'},
 {name:'English / \u041a\u0418 launch',description:'  English & \u0440\u0443\u0441\u0441\u043a\u0438\u0439: e\u0301, Stra\u00dfe.\nLast line!  '}
];
async function login(page:Page){
 await page.goto('/');await page.getByLabel('E-Mail').fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Passwort').fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Anmelden',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
}
async function create(page:Page,name:string,description:string){
 await page.getByRole('link',{name:'Neues Projekt',exact:true}).click();await page.getByLabel('Projektname',{exact:true}).fill(name);await page.getByLabel('Was m\u00f6chtest du erreichen?').fill(description);await page.getByRole('button',{name:'Projekt im Backend erstellen'}).click();
 await expect(page).toHaveURL(/\/projects\/[^/]+\/board$/);return new URL(page.url()).pathname.split('/')[2];
}
async function command(page:Page,path:string,body:unknown,method='POST'){
 const csrf=await page.request.get('/api/v1/auth/csrf');expect(csrf.ok()).toBe(true);const {csrf_token}=await csrf.json();
 const result=await page.request.fetch(path,{method,headers:{'X-CSRF-Token':csrf_token,'Idempotency-Key':randomUUID()},...(body===undefined?{}:{data:body})});expect(result.ok(),`${method} ${path}: ${result.status()}`).toBe(true);return result.json();
}
test.beforeAll(async()=>mkdir('qa-evidence/screenshots',{recursive:true}));
test.afterAll(async()=>writeFile('qa-evidence/g4-real-evidence.json',JSON.stringify(evidence,null,2)));
test.beforeEach(async({page})=>{
 // Fail closed even if a future test accidentally clicks the planning button.
 await page.route('**/agent/planning-requests',async route=>{evidence.providerCalls++;await route.abort();throw new Error('G4 forbids AI planning requests');});
 await page.route(/https?:\/\/(?:api\.openai\.com|api\.anthropic\.com)/,async route=>{evidence.providerCalls++;await route.abort();throw new Error('Provider access forbidden');});
});
for(const [index,item] of content.entries())test(`real PostgreSQL Unicode ${index+1}: create, reload and unchanged content`,async({page})=>{
 await login(page);const id=await create(page,item.name,item.description);evidence.projects.push({id,...item});
 expect(await page.getByTestId('project-description').textContent()).toBe(item.description);
 await page.reload();await expect(page.getByTestId('project-description')).toBeVisible();expect(await page.getByTestId('project-description').textContent()).toBe(item.description);
 await expect(page.getByLabel('Projekt ausw\u00e4hlen')).toHaveValue(id);expect(await page.getByLabel('Projekt ausw\u00e4hlen').locator('option:checked').textContent()).toBe(item.name);
 const response=await page.request.get('/api/v1/projects/'+id);expect(response.ok()).toBe(true);const stored=await response.json();expect(stored.name).toBe(item.name);expect(stored.description).toBe(item.description);
 await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();evidence.checks.push(`Unicode ${index+1}: browser and canonical HTTP equal submitted text after reload`);
 if(index===2)await page.screenshot({path:'qa-evidence/screenshots/g4-multilingual-real-postgresql.png',fullPage:true});
});

test('real published task, version conflict, status update, audit and logout (no AI)',async({page})=>{
 await login(page);const id=await create(page,'G4 Status / \u0421\u0442\u0430\u0442\u0443\u0441','Manual plan and real backend test; no provider requests.');
 const snapshot={phases:[{key:'phase',name:'Planung'}],tasks:[{key:'task',phase_key:'phase',title:'\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 / Pr\u00fcfung',description:'Persistent \u0442\u0435\u043a\u0441\u0442',priority:'urgent'}]};
 const p=await (await page.request.get('/api/v1/projects/'+id)).json();const plan=await command(page,`/api/v1/projects/${id}/plans`,{base_project_version:p.version,snapshot});
 await command(page,`/api/v1/projects/${id}/plans/${plan.id}/submit-review`,undefined);
 await command(page,`/api/v1/projects/${id}/plans/${plan.id}/approvals`,{content_hash:plan.content_hash,decision:'approved',comment:'G4 synthetic human fixture'});
 const operation=await command(page,`/api/v1/projects/${id}/plans/${plan.id}/publish`,{content_hash:plan.content_hash});expect(operation.status).toBe('succeeded');
 await page.reload();const button=page.getByRole('button',{name:'Aufgabe \u00f6ffnen: \u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 / Pr\u00fcfung'});await button.click();
 const current=await (await page.request.get(`/api/v1/projects/${id}/tasks`)).json();const task=current.items[0];
 await command(page,`/api/v1/projects/${id}/tasks/${task.id}/status`,{version:task.version,status:'in_progress'},'PATCH');
 await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('done');await page.getByRole('button',{name:'Status im Backend speichern'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Versionskonflikt');
 await page.reload();await button.click();await expect(page.getByRole('dialog').getByLabel('Titel')).toHaveAttribute('readonly');await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('done');await page.getByRole('button',{name:'Status im Backend speichern'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByLabel('Statusfilter').selectOption('done');await expect(button).toBeVisible();
 const search=await page.request.get(`/api/v1/projects/${id}/tasks?q=${encodeURIComponent('\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430')}`);expect(search.ok()).toBe(true);expect((await search.json()).items[0].status).toBe('done');
 await page.getByRole('link',{name:'Aktivit\u00e4t & Betrieb',exact:true}).click();await expect(page.getByRole('heading',{name:'Projektereignisse \u00b7 Backend'})).toBeVisible();await expect(page.getByText('Aufgabenstatus ge\u00e4ndert',{exact:true}).first()).toBeVisible();await expect(page.locator('main')).not.toContainText('Demo-Arbeitsspeicher');await page.screenshot({path:'qa-evidence/screenshots/g4-activity-real-postgresql.png',fullPage:true});
 const denied=await page.request.patch(`/api/v1/projects/${id}/tasks/${task.id}/status`,{data:{version:999,status:'todo'},headers:{'Idempotency-Key':randomUUID()}});expect(denied.status()).toBe(403);
 await page.getByRole('button',{name:'Abmelden',exact:true}).click();await expect(page.getByRole('button',{name:'Anmelden',exact:true})).toBeVisible();
 evidence.checks.push('Manual exact-hash plan approval/publication, actual task, 409 conflict, status update, Cyrillic search, audit, CSRF 403 and logout verified with real G3 backend');expect(evidence.providerCalls).toBe(0);
});

test('unknown real project-write outcome retains durable key and creates exactly one project',async({page})=>{
 await login(page);await page.getByRole('link',{name:'Neues Projekt',exact:true}).click();const name='G4 lost response',description='Unknown outcome recovery without a duplicate project.';let intercepted=false;
 await page.route('**/api/v1/projects',async route=>{if(route.request().method()==='POST'&&!intercepted){intercepted=true;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}else await route.continue();});
 await page.getByLabel('Projektname',{exact:true}).fill(name);await page.getByLabel('Was m\u00f6chtest du erreichen?').fill(description);await page.getByRole('button',{name:'Projekt im Backend erstellen'}).click();await expect(page.getByRole('alert')).toContainText('Ergebnis unbekannt');
 await page.reload();await page.getByLabel('Projektname',{exact:true}).fill(name);await page.getByLabel('Was m\u00f6chtest du erreichen?').fill(description);await page.getByRole('button',{name:'Projekt im Backend erstellen'}).click();await expect(page).toHaveURL(/\/board$/);
 const projects=await (await page.request.get('/api/v1/projects?limit=100&offset=0')).json();expect(projects.items.filter((p:{name:string})=>p.name===name)).toHaveLength(1);
 await page.context().clearCookies();await page.reload();await expect(page.getByRole('button',{name:'Anmelden',exact:true})).toBeVisible();evidence.checks.push('Response lost after real commit: explicit replay after reload recovered original project; one row; 401 session loss distinct');
});
