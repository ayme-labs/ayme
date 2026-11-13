import { defineConfig } from "vitest/config";

import { contractTests } from "./vitest.config";

// The recorded browser's contract on stock Playwright, one test at a time:
// each opens a browser of its own.
export default defineConfig({
  test: {
    include: [contractTests],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
