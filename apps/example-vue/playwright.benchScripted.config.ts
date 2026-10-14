import { defineConfig } from "@playwright/test";
import { certificationConfig } from "@ayme-dev/example-certification/config";

/** The value the scripted bench check gives the dev server as its model key;
 *  no decision ever reaches the server with it, see the spec. */
export const scriptedModelKey = "scripted-decisions";

const config = await certificationConfig({
  name: "vue_bench",
  // The bench pages exist on the dev server only.
  webServer: ({ port }) => ({
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    // A model key makes the dev server mount the Decision Endpoint, so the
    // pages publish `goal`; the spec answers every decision itself.
    env: { AYME_OPENROUTER_API_KEY: scriptedModelKey },
  }),
});

/**
 * The bench goal set's plumbing, without a model: its pages render and publish
 * `goal`, and goals run end to end with scripted decisions through the run
 * recorder and report. Part of `test:e2e:dev`.
 */
export default defineConfig({
  ...config,
  testMatch: "goalBenchScripted.spec.ts",
  globalSetup: undefined,
  outputDir: "test-results/bench-scripted",
});
