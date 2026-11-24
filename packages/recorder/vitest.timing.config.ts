import { defineConfig } from "vitest/config";

import { timingTests } from "./vitest.config";

// The measurements, one at a time, so that none slows another down. Each
// file says what it needs to run.
export default defineConfig({
  test: {
    include: [timingTests],
    fileParallelism: false,
  },
});
