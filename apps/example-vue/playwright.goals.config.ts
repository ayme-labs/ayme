import { defineConfig } from "@playwright/test";

/** The live lane: real goals against the real model, separate from `test:e2e`.
 *  A model answer is a judgement, not a fixed value, so a test counts as
 *  passing when one of three attempts passes. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "goals.spec.ts",
  workers: 1,
  retries: 2,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4190",
  },
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:4190",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
