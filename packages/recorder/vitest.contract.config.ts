import { defineConfig } from "vitest/config";

import { ContractRunCheck } from "./contractRunCheck";
import { contractTests } from "./vitest.config";

// The recorded browser's contract on stock Playwright, one test at a time:
// each opens a browser of its own. It runs twice: on a browser the adapter
// launches, and on a running one it attaches to.
const projects = {
  launch: {},
  attach: { AYME_RECORDER_BROWSER: "attach" },
};

export default defineConfig({
  test: {
    include: [contractTests],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    // Says whether every project ran and every skip is one the suite
    // declares; CI looks for its verdict.
    reporters: ["default", new ContractRunCheck(Object.keys(projects))],
    projects: Object.entries(projects).map(([name, env]) => ({
      extends: true,
      test: { name, env },
    })),
  },
});
