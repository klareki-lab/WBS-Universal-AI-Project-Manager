import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
// G6 API reference + isolated PostgreSQL only. Never touches owner demo or AI/MCP.
const requireBackend=createRequire(path.join(process.env.UAPM_G6_BACKEND_DIR!,'package.json'));
const {Pool}=requireBackend('pg') as {Pool:new(config:{connectionString:string})=>{
  query:(sql:string,values?:unknown[])=>Promise<{rows:Array<Record<string,any>>}>;
  end:()=>Promise<void>;
}};
const db=new Pool({connectionString:process.env.DATABASE_URL});
test.afterAll(async()=>{await db.end()});
async function command(page:Page,route:string,body:unknown){
 const csrfResponse=await page.request.get('/api/v1/auth/csrf');expect(csrfResponse.ok()).toBe(true);
 const {csrf_token}=await csrfResponse.json();
 const result=await page.request.post(route,{headers:{'X-CSRF-Token':csrf_token,'Idempotency-Key':randomUUID()},...(body===undefined?{}:{data:body})});
 expect(result.ok(),route+' '+result.status()).toBe(true);return result.json();
}
async function publish(page:Page,root:string,plan:{id:string;content_hash:string}){
 await command(page,root+'/plans/'+plan.id+'/submit-review',undefined);
 await command(page,root+'/plans/'+plan.id+'/approvals',{decision:'approved',content_hash:plan.content_hash,comment:'Isolated G6 human fixture'});
 const result=await command(page,root+'/plans/'+plan.id+'/publish',{content_hash:plan.content_hash});
 expect(result.status).toBe('succeeded');
}
test('real member assignment + dependency add/remove and cycle rejection require immutable approval',async({page})=>{
 let providerCalls=0;
 await page.route('**/agent/planning-requests',async route=>{providerCalls++;await route.abort('blockedbyclient')});
 await page.route(/https?:\/\/(?:api\.openai\.com|api\.anthropic\.com)/,async route=>{providerCalls++;await route.abort('blockedbyclient')});
 await mkdir('qa-evidence/screenshots',{recursive:true});
 await page.goto('/');
 await page.getByLabel('E-Mail').fill(process.env.ADMIN_EMAIL!);
 await page.getByLabel('Passwort').fill(process.env.ADMIN_PASSWORD!);
 await page.getByRole('button',{name:'Anmelden',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 const project=await command(page,'/api/v1/projects',{name:'G6 isolated relations',description:'Real member and task links, zero AI'});
 const root='/api/v1/projects/'+project.id;
 const editor=(await db.query("SELECT id,display_name FROM users WHERE email=$1",['g6-editor@example.invalid'])).rows[0];
 expect(editor).toBeDefined();
 await db.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'editor')",[project.id,editor.id]);
 const members=await (await page.request.get(root+'/members?limit=100&offset=0')).json();
 expect(members.items.map((m:{user_id:string})=>m.user_id)).toContain(editor.id);
 const snapshot={phases:[{key:'phase',name:'Umsetzung'}],tasks:[
  {key:'a',phase_key:'phase',title:'Analyse / Анализ',description:'Input',priority:'medium',depends_on:[]},
  {key:'b',phase_key:'phase',title:'Implementierung',description:'Work',priority:'high',depends_on:[]},
  {key:'c',phase_key:'phase',title:'Qualitätsprüfung',description:'Check',priority:'low',depends_on:[]}
 ]};
 const initial=await command(page,root+'/plans',{base_project_version:project.version,snapshot});
 await publish(page,root,initial);
 const persisted=(await (await page.request.get(root+'/tasks?limit=100&offset=0')).json()).items as Array<{id:string;source_key:string;version:number;title:string;assignee_id:string|null}>;
 const a=persisted.find(t=>t.source_key==='a')!,b=persisted.find(t=>t.source_key==='b')!;
 await page.goto('/projects/'+project.id+'/board');
 const card=page.getByRole('button',{name:'Aufgabe öffnen: Implementierung'});
 await expect(card).toBeVisible();await card.click();
 const panel=page.getByRole('dialog');
 await expect(panel.getByRole('button',{name:'Inhalte bearbeiten'})).toBeEnabled();
 await panel.getByRole('button',{name:'Inhalte bearbeiten'}).click();
 const combo=panel.getByRole('combobox',{name:'Verantwortlich'});
 await combo.fill('Ирина'); // Search by server-provided Cyrillic display name.
 await expect(panel.getByRole('option',{name:/Ирина/})).toBeVisible();
 await panel.getByRole('button',{name:/Ирина/}).click();
 await panel.getByRole('checkbox',{name:'Abhängigkeit: Analyse / Анализ'}).check();
 await expect(panel.getByRole('checkbox',{name:'Abhängigkeit: Analyse / Анализ'})).toBeChecked();
 await page.screenshot({path:'qa-evidence/screenshots/g6-named-member-dependencies-edit.png',fullPage:true});
 await panel.getByRole('button',{name:'Änderungen als Entwurf speichern'}).click();
 await expect(panel.getByTestId('task-draft-saved')).toBeVisible();
 const draftId=await panel.getByTestId('task-draft-saved').locator('p.font-mono').first().textContent();
 expect(draftId).toBeTruthy();
 const draft=await (await page.request.get(root+'/plans/'+draftId)).json();
 const changed=draft.snapshot.tasks.find((t:{task_id:string})=>t.task_id===b.id);
 expect(changed).toMatchObject({assignee_id:editor.id,depends_on:[a.id]});
 expect((await (await page.request.get(root+'/tasks/'+b.id)).json()).assignee_id).toBeNull();
 await panel.getByRole('link',{name:'Diesen Entwurf prüfen'}).click();
 await expect(page.getByTestId('plan-version-id')).toHaveText(draft.id);
 await expect(page.getByTestId('plan-hash')).toContainText(draft.content_hash);
 await page.getByRole('button',{name:'Review einreichen'}).click();
 await page.getByRole('checkbox',{name:/Ich genehmige ausdrücklich/}).check();
 await page.getByRole('button',{name:'Version freigeben'}).click();
 await page.getByRole('button',{name:'Plan veröffentlichen'}).click();
 await page.getByRole('link',{name:'Zum Kanban',exact:true}).click();
 await page.reload();
 await expect(card).toContainText(editor.display_name);
 await card.click();
 const publishedPanel=page.getByRole('dialog');
 await expect(publishedPanel.getByRole('list',{name:'Aktuelle Abhängigkeiten'})).toContainText('Analyse / Анализ');
 await page.screenshot({path:'qa-evidence/screenshots/g6-published-assignee-kanban.png',fullPage:true});
 await publishedPanel.getByRole('button',{name:'Details schließen'}).click();
 // Backend must reject an attempted cycle: A -> B while B -> A is published.
 await page.getByRole('button',{name:'Aufgabe öffnen: Analyse / Анализ'}).click();
 const cyclePanel=page.getByRole('dialog');
 await cyclePanel.getByRole('button',{name:'Inhalte bearbeiten'}).click();
 await cyclePanel.getByRole('checkbox',{name:'Abhängigkeit: Implementierung'}).check();
 await cyclePanel.getByRole('button',{name:'Änderungen als Entwurf speichern'}).click();
 await expect(cyclePanel.getByRole('alert')).toContainText('Zyklus');
 await expect(cyclePanel.getByTestId('task-draft-saved')).toHaveCount(0);
 await cyclePanel.getByRole('button',{name:'Details schließen'}).click();
 // Remove the predecessor from B, create another exact draft and publish.
 await card.click();const remove=page.getByRole('dialog');
 await remove.getByRole('button',{name:'Inhalte bearbeiten'}).click();
 await remove.getByRole('button',{name:'Abhängigkeit Analyse / Анализ entfernen'}).click();
 await expect(remove.getByText('Keine Vorgängeraufgaben ausgewählt.')).toBeVisible();
 await remove.getByRole('button',{name:'Änderungen als Entwurf speichern'}).click();
 await expect(remove.getByTestId('task-draft-saved')).toBeVisible();
 await remove.getByRole('link',{name:'Diesen Entwurf prüfen'}).click();
 const lastPlanId=await page.getByTestId('plan-version-id').textContent();
 expect(lastPlanId).not.toBe(draft.id);
 await page.getByRole('button',{name:'Review einreichen'}).click();
 await page.getByRole('checkbox',{name:/Ich genehmige ausdrücklich/}).check();
 await page.getByRole('button',{name:'Version freigeben'}).click();
 await page.getByRole('button',{name:'Plan veröffentlichen'}).click();
 await page.getByRole('link',{name:'Zum Kanban',exact:true}).click();await page.reload();
 await card.click();
 await expect(page.getByRole('dialog').getByText('Keine Vorgängeraufgaben ausgewählt.')).toBeVisible();
 const updated=await (await page.request.get(root+'/tasks/'+b.id)).json();
 expect(updated.assignee_id).toBe(editor.id);
 const edges=await (await page.request.get(root+'/tasks/'+b.id+'/dependencies')).json();
 expect(edges.items).toHaveLength(0);
 const rows=await db.query('SELECT depends_on_id FROM task_dependencies WHERE project_id=$1 AND task_id=$2',[project.id,b.id]);
 expect(rows.rows).toHaveLength(0);
 // Revoking project membership does not invent a replacement name or auto-unassign.
 await db.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[project.id,editor.id]);
 await page.reload();await card.click();
 await expect(page.getByRole('dialog').getByText(/Bisherige Zuweisung/)).toBeVisible();
 await expect(page.getByRole('dialog').getByText(/nicht im aktuellen Mitgliederverzeichnis/)).toBeVisible();
 expect(providerCalls).toBe(0);
 await writeFile('qa-evidence/g6-relations-real.json',JSON.stringify({
  backend:'pinned G6 + isolated PostgreSQL',project_id:project.id,changed_task_id:b.id,
  initial_plan_id:initial.id,assignment_plan_id:draft.id,removal_plan_id:lastPlanId,
  assignment_member_id:editor.id,cyclesRejected:true,dependenciesAddedAndRemoved:true,
  membershipRevocationShown:true,afterReloadAssignee:updated.assignee_id,
  rowsAfterRemoval:rows.rows.length,providerCalls
 },null,2));
});
