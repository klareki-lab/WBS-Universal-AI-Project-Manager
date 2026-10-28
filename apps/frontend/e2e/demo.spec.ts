import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

async function menu(page:Page){
  if((page.viewportSize()?.width??1440)<1024)await page.getByRole('button',{name:'Navigation öffnen',exact:true}).click();
  return page.getByRole('navigation',{name:'Hauptmenü',exact:true});
}
test.beforeAll(async()=>{await mkdir('qa-evidence/screenshots',{recursive:true})});

test('actual React dashboard has official branding and fits the viewport',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Klare KI — KI Project Studio');
  await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
  await expect(page.getByText('Interaktiver Demo-Modus.',{exact:false})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/kompass/i);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`qa-evidence/screenshots/${info.project.name}-dashboard.png`,fullPage:true});
  await menu(page);
  await expect(page.getByRole('complementary',{name:'Hauptnavigation'})).toContainText('Klare KI');
  await expect(page.getByRole('complementary',{name:'Hauptnavigation'})).toContainText('KI PROJECT STUDIO');
  expect(errors).toEqual([]);
});

test('preserves board, planning, review, approval, activity and settings routes',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
  await (await menu(page)).getByRole('link',{name:'Projektaufgaben',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Projekt-Workspace',exact:true})).toBeVisible();
  await page.screenshot({path:`qa-evidence/screenshots/${info.project.name}-board.png`,fullPage:true});
  await page.getByRole('button',{name:'Liste',exact:true}).click();await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button',{name:'Kanban',exact:true}).click();
  await (await menu(page)).getByRole('link',{name:'AI Planungsstudio',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Von Gedanken zu Aufgaben.'})).toBeVisible();
  await page.screenshot({path:`qa-evidence/screenshots/${info.project.name}-planning.png`,fullPage:true});
  await (await menu(page)).getByRole('link',{name:'Plan prüfen',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Änderungen bewusst prüfen.'})).toBeVisible();
  await page.getByRole('link',{name:'Planversion entscheiden',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Entscheidungen mit Versionsbezug.'})).toBeVisible();
  await (await menu(page)).getByRole('link',{name:'Aktivität & Betrieb',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Aktivität & Betrieb',exact:true})).toBeVisible();
  await (await menu(page)).getByRole('link',{name:'Einstellungen',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Einstellungen & Systemstatus',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
