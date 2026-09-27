import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

/** The live lane: real goals against the real model, separate from `test:e2e`.
 *  A model answer is a judgement, not a fixed value, so a test counts as
 *  passing when one of three attempts passes. */
export default defineConfig({
  ...config,
  testMatch: "goals.spec.ts",
  retries: 2,
  timeout: 60_000,
});
