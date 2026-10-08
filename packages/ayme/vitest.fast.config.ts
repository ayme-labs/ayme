import {
  defineFastLaneConfig,
  fastLaneExcludes,
} from "@ayme-dev/test-config/vitest";
import { configDefaults, defineConfig } from "vitest/config";

import browserConfig from "./vitest.browser.config.ts";
import unitConfig from "./vitest.config.ts";

// The unit and browser suites run as separate tasks in CI; the fast lane
// runs both in one Vitest run, so their coverage lands in one report.
export default defineFastLaneConfig(
  defineConfig({
    test: {
      projects: [
        {
          test: {
            ...unitConfig.test,
            name: "unit",
            exclude: [
              ...configDefaults.exclude,
              ...(unitConfig.test?.exclude ?? []),
              ...fastLaneExcludes,
            ],
          },
        },
        ...(browserConfig.test?.projects ?? []),
      ],
    },
  })
);
