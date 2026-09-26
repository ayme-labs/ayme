import { defineConfig } from "@playwright/test";

/** The run harness's goal set: goals `pnpm run goals:runs` measures by
 *  default, allowed to fail, so neither CI nor `test:goals` runs them. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "goalHarness.spec.ts",
  workers: 1,
  retries: 0,
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
