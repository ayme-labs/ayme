import { defineConfig, devices } from "@playwright/test";

/**
 * The lab app's Page Object qualification, against the running lab app. Run
 * by `lab:qualify`.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.qualify.ts",
  fullyParallel: false,
  // The tests share the one lab app, whose dev server compiles each screen on
  // its first request; the second test compiles them before it starts.
  workers: 1,
  retries: 0,
  // Turbopack compiles each page on its first request, which can take a minute.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
