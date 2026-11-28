import { CompatRunCheck } from "@ayme-dev/test-config/compat-run-check";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";

import { compatTests } from "./vitest.config";

// The compatibility suite: one test at a time, since each starts a browser
// of its own. Each test opens or joins a browser itself, so one project
// holds both.
const projects = ["browser"];

/** The suite's project, whole, so that the coverage behind the CRAP score
 * can run it too (vitest.crap.config.ts). */
export const compatProjects: TestProjectInlineConfiguration[] = projects.map(
  (name) => ({
    test: {
      name,
      include: [compatTests],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 30_000,
    },
  })
);

export default defineConfig({
  test: {
    // Says whether every project ran and every skip is one the suite
    // declares; CI looks for its verdict.
    reporters: ["default", new CompatRunCheck(projects)],
    projects: compatProjects,
  },
});
