import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

// Real React application, controlled HTTP responses. NOT evidence of a live backend/MCP test.
const user={id:'11111111-1111-4111-8111-111111111111',display_name:'HTTP fixture user'};
const expired={error:{code:'session_expired',message:'Session expired',request_id:'fixture-session'}};
test.beforeAll(async()=>{await mkdir('qa-evidence/screenshots',{recursive:true})});

test('live mode shows the branded login screen when the session is expired',async({page})=>{
  await page.route('**/api/v1/**',route=>route.fulfill({status:401,json:expired}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Klare KI',exact:true})).toBeVisible();
  await expect(page.getByLabel('E-Mail')).toBeVisible();await expect(page.getByLabel('Passwort')).toBeVisible();
  await expect(page.getByText('Interaktiver Demo-Modus.',{exact:false})).toHaveCount(0);
  await page.screenshot({path:'qa-evidence/screenshots/live-mode-login-http-fixture.png',fullPage:true});
});

test('invalid credentials never expose an authenticated dashboard',async({page})=>{
  let projectRequests=0;
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;if(path.includes('/projects'))projectRequests++;
    await route.fulfill({status:401,json:{error:{code:'invalid_credentials',message:'Test authentication rejected',request_id:'fixture-auth'}}});
  });
  await page.goto('/');await page.getByLabel('E-Mail').fill('qa@example.invalid');await page.getByLabel('Passwort').fill('not-a-real-password');
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Test authentication rejected');expect(projectRequests).toBe(0);
  await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toHaveCount(0);
});

test('malformed CSRF bootstrap fails closed instead of issuing writes',async({page})=>{
  let writes=0;await page.route('**/api/v1/**',async route=>{if(route.request().method()!=='GET')writes++;await route.fulfill({json:user})});
  await page.goto('/');await expect(page.getByRole('button',{name:'Anmelden',exact:true})).toBeVisible();
  expect(writes).toBe(0);
});

test('confirmed login renders the shared UI and logout returns to the session gate',async({page})=>{
  let signedIn=false;
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/auth/login')){signedIn=true;return route.fulfill({json:{user,csrf_token:'test-csrf-token'}})}
    if(path.endsWith('/auth/logout')){expect(route.request().headers()['x-csrf-token']).toBe('test-csrf-token');signedIn=false;return route.fulfill({status:204})}
    if(path.endsWith('/auth/session'))return route.fulfill({status:signedIn?200:401,json:signedIn?user:expired});
    return route.fulfill({json:{items:[],limit:100,offset:0}});
  });
  await page.goto('/');await page.getByLabel('E-Mail').fill('qa@example.invalid');await page.getByLabel('Passwort').fill('not-a-real-password');
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Projekte klar steuern. Menschen entscheiden.'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Hauptmenü'}).getByRole('link',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByText('Interaktiver Demo-Modus.',{exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Abmelden',exact:true}).click();
  await expect(page.getByRole('button',{name:'Anmelden',exact:true})).toBeVisible();
});
