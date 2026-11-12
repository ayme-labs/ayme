import {defineConfig} from '@playwright/test';
export default defineConfig({outputDir:'./test-results',testDir:'.',testMatch:'replay.spec.ts',timeout:20000,use:{browserName:'chromium',viewport:{width:1100,height:900}},reporter:'list'});
