import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
// Real G3-compatible backend and PostgreSQL. No model, n8n or MCP execution.
async function command(page:Page,path:string,body:unknown){
 const token=await page.request.get('/api/v1/auth/csrf');expect(token.ok()).toBe(true);
 const {csrf_token}=await token.json();
 const response=await page.request.post(path,{headers:{'X-CSRF-Token':csrf_token,'Idempotency-Key':randomUUID()},...(body===undefined?{}:{data:body})});
 expect(response.ok(),`${path}: ${response.status()}`).toBe(true);return response.json();
}
test('edit selected task, recover one draft, approve exact hash and publish without changing other tasks',async({page})=>{
 let aiRequests=0;
 await page.route('**/agent/planning-requests',route=>{aiRequests++;return route.abort()});
 await page.route(/https?:\/\/(?:api\.openai\.com|api\.anthropic\.com)/,route=>{aiRequests++;return route.abort()});
 await mkdir('qa-evidence/screenshots',{recursive:true});
 await page.goto('/');await page.getByLabel('E-Mail').fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Passwort').fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Anmelden',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 const user=await (await page.request.get('/api/v1/auth/session')).json();
 const project=await command(page,'/api/v1/projects',{name:'SYNTHETISCH Task editor acceptance',description:'Real task metadata; zero AI requests.'});const root=`/api/v1/projects/${project.id}`;
 const snapshot={phases:[{key:'phase',name:'Planung'}],tasks:[
  {key:'first',phase_key:'phase',title:'First task stays unchanged',description:'Keep this description',priority:'low'},
  {key:'second',phase_key:'phase',title:'Selected task to edit',description:'Original second description',priority:'medium',start_date:'2026-11-01',due_date:'2026-12-01',estimated_effort:5,definition_of_done:'Preserve this acceptance criterion',depends_on:['first']}
 ]};
 const original=await command(page,root+'/plans',{base_project_version:project.version,snapshot});
 await command(page,root+`/plans/${original.id}/submit-review`,undefined);
 await command(page,root+`/plans/${original.id}/approvals`,{content_hash:original.content_hash,decision:'approved',comment:'Synthetic human initial fixture'});
 expect((await command(page,root+`/plans/${original.id}/publish`,{content_hash:original.content_hash})).status).toBe('succeeded');
 const initial=(await (await page.request.get(root+'/tasks')).json()).items;
 const target=initial.find((t:{source_key:string})=>t.source_key==='second');const other=initial.find((t:{source_key:string})=>t.source_key==='first');
 await page.goto(`/projects/${project.id}/board`);await page.getByRole('button',{name:'Aufgabe \u00f6ffnen: Selected task to edit'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Inhalte bearbeiten',exact:true}).click();
 const title='\u0410\u043d\u0430\u043b\u0438\u0437 / Analyse / Analysis';const description='  \u041d\u043e\u0432\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435.\nGr\u00f6\u00dfe & e\u0301.\nEnglish: \u201cquotes\u201d.  ';
 await dialog.getByLabel('Titel',{exact:true}).fill(title);await dialog.getByLabel('Beschreibung',{exact:true}).fill(description);await dialog.getByLabel('Priorit\u00e4t',{exact:true}).selectOption('high');await dialog.getByLabel('F\u00e4lligkeit',{exact:true}).fill('2026-12-20');await dialog.getByRole('combobox',{name:'Verantwortlich'}).fill(user.display_name);
 await dialog.getByRole('button',{name:new RegExp(user.display_name)}).click();
 await expect(dialog.getByLabel('Status',{exact:true})).toBeDisabled();await expect(dialog.getByRole('checkbox',{name:'Abhängigkeit: First task stays unchanged'})).toBeChecked();
 await page.screenshot({path:'qa-evidence/screenshots/task-editable-real-backend.png',fullPage:true});
 let lost=false;let created:{id:string;content_hash:string}|undefined;const keys:string[]=[];
 // Lose the first response AFTER PostgreSQL committed it; explicit replay must reuse that operation key.
 await page.route('**/api/v1/projects/*/tasks/'+target.id,async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  keys.push(route.request().headers()['idempotency-key']);
  if(!lost){lost=true;const response=await route.fetch();expect(response.status()).toBe(201);created=await response.json();return route.abort('failed')}
  return route.continue();
 });
 const save=dialog.getByRole('button',{name:'\u00c4nderungen als Entwurf speichern',exact:true});await save.click();await expect(dialog.getByRole('alert')).toContainText('Ergebnis unbekannt');await expect(dialog.getByLabel('Beschreibung')).toHaveValue(description);expect(keys).toHaveLength(1);
 await save.click();await expect(page.getByTestId('task-draft-saved')).toBeVisible();expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);await expect(save).toBeDisabled();
 expect(created).toBeDefined();const draft=await (await page.request.get(root+`/plans/${created!.id}`)).json();expect(draft.status).toBe('draft');expect(draft.content_hash).toBe(created!.content_hash);
 const edit=draft.snapshot.tasks.find((t:{task_id:string})=>t.task_id===target.id);expect(edit).toMatchObject({title,description,priority:'high',due_date:'2026-12-20',assignee_id:user.id,start_date:'2026-11-01',estimated_effort:5,definition_of_done:'Preserve this acceptance criterion',expected_version:target.version});expect(edit.depends_on).toEqual([other.id]);
 const beforePublish=await (await page.request.get(root+`/tasks/${target.id}`)).json();expect(beforePublish.title).toBe('Selected task to edit');expect(beforePublish.description).toBe('Original second description');
 expect((await (await page.request.get(root+'/plans')).json()).items).toHaveLength(2);
 const oldPlan=await (await page.request.get(root+`/plans/${original.id}`)).json();expect(oldPlan.snapshot.tasks.find((t:{key:string})=>t.key==='second').title).toBe('Selected task to edit');
 await page.screenshot({path:'qa-evidence/screenshots/task-draft-saved-real-backend.png',fullPage:true});
 await page.getByRole('link',{name:'Diesen Entwurf pr\u00fcfen',exact:true}).click();await expect(page).toHaveURL(new RegExp('/review\\?plan='+created!.id));await expect(page.getByTestId('plan-version-id')).toHaveText(created!.id);await expect(page.getByTestId('plan-hash')).toContainText(created!.content_hash);
 await expect(page.getByTestId('plan-next-step')).toContainText('Planversion v2');await expect(page.getByRole('button',{name:'Review einreichen',exact:true})).toBeVisible();await page.screenshot({path:'qa-evidence/screenshots/task-manual-next-step-real-backend.png',fullPage:true});
 await page.getByRole('button',{name:'Review einreichen',exact:true}).click();await page.getByRole('checkbox',{name:/Ich genehmige ausdr/}).check();await page.getByRole('button',{name:'Version freigeben',exact:true}).click();await page.getByRole('button',{name:'Plan ver\u00f6ffentlichen',exact:true}).click();await expect(page.getByText('Plan ver\u00f6ffentlicht. Aufgaben sind im Kanban gespeichert.',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Zum Kanban',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Aufgabe \u00f6ffnen: '+title,exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Beschreibung')).toHaveValue(description);
 const actual=await (await page.request.get(root+`/tasks/${target.id}`)).json();expect(actual).toMatchObject({id:target.id,title,description,priority:'high',due_date:'2026-12-20',assignee_id:user.id,start_date:'2026-11-01',estimated_effort:5,definition_of_done:'Preserve this acceptance criterion'});
 const preserved=await (await page.request.get(root+`/tasks/${other.id}`)).json();expect(preserved.title).toBe(other.title);expect(preserved.description).toBe(other.description);expect(preserved.priority).toBe(other.priority);
 const edges=await (await page.request.get(root+`/tasks/${target.id}/dependencies`)).json();expect(edges.items.map((e:{depends_on_id:string})=>e.depends_on_id)).toContain(other.id);
 await page.screenshot({path:'qa-evidence/screenshots/task-edited-published-real-backend.png',fullPage:true});
 // Exercise the independent status-only flow on the unchanged synthetic task, then restore it.
 await page.getByRole('dialog').getByRole('button',{name:'Details schließen'}).click();
 await page.getByRole('button',{name:'Aufgabe öffnen: First task stays unchanged',exact:true}).click();
 await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('in_progress');
 await page.getByRole('dialog').getByRole('button',{name:'Status im Backend speichern'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();
 const moved=await (await page.request.get(root+`/tasks/${other.id}`)).json();expect(moved.status).toBe('in_progress');expect(moved.title).toBe(other.title);
 await page.getByRole('button',{name:'Aufgabe öffnen: First task stays unchanged',exact:true}).click();
 await page.getByRole('dialog').getByLabel('Status',{exact:true}).selectOption('todo');
 await page.getByRole('dialog').getByRole('button',{name:'Status im Backend speichern'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await (await page.request.get(root+`/tasks/${other.id}`)).json()).status).toBe('todo');
 await page.goto(`/projects/${project.id}/review?plan=${randomUUID()}`);await expect(page.getByTestId('plan-version-id')).toHaveCount(0);await expect(page.getByRole('button',{name:'Version freigeben',exact:true})).toHaveCount(0);await expect(page.getByText(/Die angeforderte Planversion/)).toBeVisible();
 expect(aiRequests).toBe(0);
 await writeFile('qa-evidence/task-edit-real.json',JSON.stringify({backend:process.env.UAPM_RUNTIME_EVIDENCE==='g3'?'existing isolated G3 PostgreSQL and localhost:25174':'pinned G3 + ephemeral PostgreSQL',project_id:project.id,task_id:target.id,plan_id:created!.id,content_hash:created!.content_hash,manualReplaySameKey:keys[0]===keys[1],draftCountBeforePublication:2,metadataEqualsSubmitted:true,otherTaskUnchanged:true,dependenciesPreserved:true,statusOnlyPersistedAndRestored:true,unshownMetadataPreserved:true,originalSnapshotUnchanged:true,publishedAfterSyntheticHumanFixtureApproval:true,providerRequests:aiRequests},null,2));
});
