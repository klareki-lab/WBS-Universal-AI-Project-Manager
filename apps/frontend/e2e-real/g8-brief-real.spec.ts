import {test,expect} from '@playwright/test';
// Dedicated PostgreSQL and backend; no external AI adapter or credentials.
test('structured project brief survives storage and reaches the planning request',async({page})=>{
 await page.goto('/');await page.getByLabel('E-Mail').fill(process.env.ADMIN_EMAIL!);await page.getByLabel('Passwort').fill(process.env.ADMIN_PASSWORD!);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
 await page.goto('/projects/new');await page.getByRole('button',{name:'Mit Formular starten'}).click();
 await page.getByLabel('Projektname',{exact:true}).fill('SYNTHETISCH G8 Projektbrief');
 await page.getByLabel('Beschreibung',{exact:true}).fill('Ein rein synthetisches Projekt für die Prüfung.');
 await page.getByLabel('Projektziele',{exact:true}).fill('Ein verständliches Ergebnis erstellen.');
 await page.getByLabel('Anforderungen',{exact:true}).fill('Deutsch als Standardsprache; keep quoted English text.');
 await page.getByLabel('Beginn',{exact:true}).fill('2026-11-01');await page.getByLabel('Ende',{exact:true}).fill('2026-12-15');
 await page.getByRole('button',{name:'Projekt erstellen',exact:true}).click();await expect(page).toHaveURL(/\/board$/);
 const id=page.url().split('/')[4];const project=await (await page.request.get('/api/v1/projects/'+id)).json();
 expect(project).toMatchObject({goals:'Ein verständliches Ergebnis erstellen.',requirements:'Deutsch als Standardsprache; keep quoted English text.',start_date:'2026-11-01',end_date:'2026-12-15'});
 await page.goto('/projects/'+id+'/workspace');await page.getByLabel('Planungsziel').fill('Erstelle einen ersten Plan.');await page.getByRole('button',{name:'Planung anfordern',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Planungsauftrag erstellt'})).toBeVisible();
 const jobs=await (await page.request.get('/api/v1/projects/'+id+'/operations')).json();const input=jobs.items.find((x:{kind:string})=>x.kind==='planning').input;
 expect(input.project_context).toMatchObject({name:project.name,description:project.description,goals:project.goals,requirements:project.requirements,start_date:project.start_date,end_date:project.end_date});
 expect(input.language_instruction).toContain('standardmäßig auf Deutsch');expect(input.prompt).toBe('Erstelle einen ersten Plan.');
});
