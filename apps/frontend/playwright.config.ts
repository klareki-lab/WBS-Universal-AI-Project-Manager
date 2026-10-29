import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['json', { outputFile: 'qa-evidence/playwright.json' }]],
  outputDir: 'qa-evidence/browser-results',
  use: { browserName: 'chromium', launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-demo', testMatch: /demo\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:15173', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-demo', testMatch: /demo\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:15173', viewport: { width: 390, height: 844 } } },
    { name: 'live-http-fixtures', testMatch: /(session|g4)\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:15174', viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 15173', url: 'http://127.0.0.1:15173', reuseExistingServer: false, env: { VITE_DATA_MODE: 'mock', VITE_API_BASE_URL: '' } },
    { command: 'npm run dev -- --port 15174', url: 'http://127.0.0.1:15174', reuseExistingServer: false, env: { VITE_DATA_MODE: 'live', VITE_API_BASE_URL: '' } },
  ],
});
