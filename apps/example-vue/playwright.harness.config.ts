import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

/** The run harness's goal set: goals `pnpm run goals:runs` measures by
 *  default, allowed to fail, so neither CI nor `test:goals` runs them. */
export default defineConfig({
  ...config,
  testMatch: "goalHarness.spec.ts",
  retries: 0,
  timeout: 60_000,
});
