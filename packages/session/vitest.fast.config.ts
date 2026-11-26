import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";

import baseConfig from "./vitest.config";

// The unit tests: what a mutation run runs and what the CRAP score counts.
// The code under `infrastructure/live/` drives a real browser: the command's
// end-to-end tests in apps/mcp-fixture measure it
// (docs/testing.md#code-a-real-browser-runs).
export default defineFastLaneConfig(baseConfig);
