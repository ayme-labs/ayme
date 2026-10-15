import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

/** The bench goal set: goals on the bench pages, which have no Page Objects,
 *  that `pnpm run goals:runs --goal-set bench` measures. Allowed to fail, so
 *  neither CI nor `test:goals` runs them. The longest goal takes up to 20
 *  steps, so a test gets several minutes. */
export default defineConfig({
  ...config,
  testMatch: "goalBench.spec.ts",
  retries: 0,
  timeout: 300_000,
});
