import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";

import baseConfig from "./vitest.config";

// The unit tests: what a mutation run runs. The coverage behind the CRAP
// score also counts the contract suite (vitest.crap.config.ts).
export default defineFastLaneConfig(baseConfig);
