import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

/** The repro goal set for issue 536 (`goalRepro536.spec.ts`): goals the Goal
 *  Loop hands over "done" for one step early. Measured by
 *  `pnpm run goals:runs --goal-set repro536`; neither CI nor `test:goals`
 *  runs it. */
export default defineConfig({
  ...config,
  testMatch: "goalRepro536.spec.ts",
  retries: 0,
  timeout: 300_000,
});
