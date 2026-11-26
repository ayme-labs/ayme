import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";

import baseConfig from "./vitest.config";

// The unit tests: what a mutation run runs and what the CRAP score counts.
// How the code under `infrastructure/live/` is measured instead:
// docs/testing.md#code-a-real-browser-runs.
export default defineFastLaneConfig(baseConfig);
