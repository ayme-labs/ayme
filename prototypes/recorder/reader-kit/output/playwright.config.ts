import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'flow.spec.ts',
  use: { baseURL: 'https://www.saucedemo.com', testIdAttribute: 'data-test', headless: true },
  reporter: 'list',
});
