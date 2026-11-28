import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";
import { defineConfig } from "vitest/config";

import { compatProjects } from "./vitest.compat.config";
import unitConfig from "./vitest.config";

// The coverage behind the CRAP score: the unit tests and the compatibility
// suite, on this package's own Playwright. See
// docs/testing.md#code-a-real-browser-runs.
export default defineFastLaneConfig(
  defineConfig({
    test: {
      projects: [
        { test: { ...unitConfig.test, name: "unit" } },
        ...compatProjects,
      ],
    },
  })
);
