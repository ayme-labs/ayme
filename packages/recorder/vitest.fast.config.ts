import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";
import { defineConfig } from "vitest/config";

import { contractProjects } from "./vitest.contract.config";
import unitConfig from "./vitest.config";

// The unit tests and the contract suite run as separate tasks in CI; the
// fast lane runs both in one Vitest run, on this package's own Playwright,
// so that the adapter the contract suite exercises is measured with the rest.
export default defineFastLaneConfig(
  defineConfig({
    test: {
      projects: [
        { test: { ...unitConfig.test, name: "unit" } },
        ...contractProjects,
      ],
    },
  })
);
