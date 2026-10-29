import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
// Only the dedicated G8 database; all people and projects are synthetic.
async function command(page:Page,path:string,body:unknown){
 const csrf=(await (await page.request.get('/api/v1/auth/csrf')).json()).csrf_token;
 const response=await page.request.post(path,{headers:{'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:body});
 expect(response.ok(),`${path}: ${response.status()}`).toBe(true);return response.json();
}
test('owner manages a synthetic team and publishes an assignment only after approval',async({page,browser})=>{
 let paidProviderRequests=0;await page.route(/https?:\/\/(?:api\.openai\.com|api\.anthropic\.com)/,route=>{paidProviderRequests++;return route.abort()});
 await page.goto('/');await page.getByLabel('E-Mail').fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Passwort').fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 const priorProjects=(await (await page.request.get('/api/v1/projects?limit=100&offset=0')).json()).items;
 const project=await command(page,'/api/v1/projects',{name:'SYNTHETISCH G8 Team',description:'Synthetischer Akzeptanztest'});const root='/api/v1/projects/'+project.id;
 const snapshot={phases:[{key:'plan',name:'Planung'}],tasks:[{key:'aufgabe',phase_key:'plan',title:'SYNTHETISCH Teamaufgabe',description:'Test',priority:'medium'}]};
 const initial=await command(page,root+'/plans',{base_project_version:project.version,snapshot});await command(page,root+`/plans/${initial.id}/submit-review`,undefined);await command(page,root+`/plans/${initial.id}/approvals`,{content_hash:initial.content_hash,decision:'approved'});await command(page,root+`/plans/${initial.id}/publish`,{content_hash:initial.content_hash});
 await page.goto(`/projects/${project.id}/team`);await expect(page.getByRole('heading',{name:'Projektteam'})).toBeVisible();
 for(const person of ['SYNTHETISCH Testperson A','SYNTHETISCH Testperson B','SYNTHETISCH Testperson C']){const row=page.locator('li').filter({hasText:person});await row.getByRole('button',{name:'Zum Projekt hinzufügen'}).click();await expect(page.getByRole('status').filter({hasText:'Mitglied hinzugefügt'})).toBeVisible();}
 await page.getByLabel('Rolle für SYNTHETISCH Testperson A').selectOption('editor');await expect(page.getByRole('status').filter({hasText:'Rolle gespeichert'})).toBeVisible();
 await mkdir('qa-evidence/g8',{recursive:true});await page.screenshot({path:'qa-evidence/g8/team.png',fullPage:true});
 const members=(await (await page.request.get(root+'/members')).json()).items;const chosen=members.find((m:{display_name:string})=>m.display_name==='SYNTHETISCH Testperson A');expect(chosen.role).toBe('editor');
 await page.goto(`/projects/${project.id}/board`);await page.getByRole('button',{name:'Aufgabe öffnen: SYNTHETISCH Teamaufgabe'}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Inhalte bearbeiten'}).click();await dialog.getByRole('combobox',{name:'Verantwortlich'}).fill('SYNTHETISCH Testperson A');await dialog.getByRole('button',{name:/SYNTHETISCH Testperson A/}).click();await dialog.getByRole('button',{name:'Änderungen als Entwurf speichern'}).click();await expect(page.getByTestId('task-draft-saved')).toBeVisible();
 const tasksBefore=(await (await page.request.get(root+'/tasks')).json()).items;expect(tasksBefore[0].assignee_id).toBeNull();
 await page.getByRole('link',{name:'Diesen Entwurf prüfen'}).click();await page.getByRole('button',{name:'Review einreichen'}).click();await page.getByRole('checkbox',{name:/Ich genehmige ausdrücklich/}).check();await page.getByRole('button',{name:'Version freigeben'}).click();await page.getByRole('button',{name:'Plan veröffentlichen'}).click();await expect(page.getByText('Plan veröffentlicht. Aufgaben sind im Kanban gespeichert.')).toBeVisible();
 await page.goto(`/projects/${project.id}/board`);await page.reload();await expect(page.getByRole('button',{name:'Aufgabe öffnen: SYNTHETISCH Teamaufgabe'})).toContainText('SYNTHETISCH Testperson A');
 expect((await (await page.request.get(root+'/tasks')).json()).items[0].assignee_id).toBe(chosen.user_id);await page.screenshot({path:'qa-evidence/g8/published-assignment.png',fullPage:true});
 await page.goto('/activity');await expect(page.getByText('Teammitglied hinzugefügt').first()).toBeVisible();await expect(page.getByText('Rolle im Projektteam geändert')).toBeVisible();
 const employeeContext=await browser.newContext();const employee=await employeeContext.newPage();await employee.goto('/');await employee.getByLabel('E-Mail').fill('g8-person-a@example.test');await employee.getByLabel('Passwort').fill('synthetic-g8-employee-password');await employee.getByRole('button',{name:'Anmelden',exact:true}).click();await expect(employee.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 const csrf=(await (await employee.request.get('/api/v1/auth/csrf')).json()).csrf_token;
 const denied=await employee.request.post(root+'/members/'+members.find((m:{display_name:string})=>m.display_name==='SYNTHETISCH Testperson B').user_id,{headers:{'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()},data:{role:'editor'}});expect(denied.status()).toBe(403);
 await employeeContext.close();const afterProjects=(await (await page.request.get('/api/v1/projects?limit=100&offset=0')).json()).items.filter((p:{id:string})=>p.id!==project.id);expect(afterProjects).toEqual(priorProjects);expect(paidProviderRequests).toBe(0);await writeFile('qa-evidence/g8/real-backend-result.json',JSON.stringify({environment:'dedicated synthetic G8 PostgreSQL and local backend',teamMembers:3,priorSyntheticProjectsUnchanged:true,unauthorizedStatus:denied.status(),draftAssignmentHiddenBeforePublication:true,publishedAssignmentPersistedAfterReload:true,paidProviderRequests},null,2));
});
