import { defineConfig } from "vitest/config";

import { contractTests } from "./vitest.config";

// The recorded browser's contract on stock Playwright, one test at a time:
// each opens a browser of its own. It runs twice: on a browser the adapter
// launches, and on a running one it attaches to.
export default defineConfig({
  test: {
    include: [contractTests],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    projects: [
      { extends: true, test: { name: "launch" } },
      {
        extends: true,
        test: { name: "attach", env: { AYME_RECORDER_BROWSER: "attach" } },
      },
    ],
  },
});
