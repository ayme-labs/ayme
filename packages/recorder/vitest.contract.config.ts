import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";

import { ContractRunCheck } from "./contractRunCheck";
import { contractTests } from "./vitest.config";

// The recorded browser's contract on stock Playwright, one test at a time:
// each opens a browser of its own. It runs twice: on a browser the adapter
// launches, and on a running one it attaches to.
const projects = {
  launch: {},
  attach: { AYME_RECORDER_BROWSER: "attach" },
};

/** The suite's two projects, whole, so that the fast lane can run them too
 * (vitest.fast.config.ts). */
export const contractProjects: TestProjectInlineConfiguration[] =
  Object.entries(projects).map(([name, env]) => ({
    test: {
      name,
      env,
      include: [contractTests],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 30_000,
    },
  }));

export default defineConfig({
  test: {
    // Says whether every project ran and every skip is one the suite
    // declares; CI looks for its verdict.
    reporters: ["default", new ContractRunCheck(Object.keys(projects))],
    projects: contractProjects,
  },
});
