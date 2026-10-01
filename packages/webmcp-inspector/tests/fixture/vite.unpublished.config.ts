import { mergeConfig } from "vite";

import base from "./vite.config";

/**
 * Serves the fixture pages with WebMCP publication off, as the Ayme bundler
 * plugin does without `publish: true`.
 */
export default mergeConfig(base, {
  define: { __AYME_WEBMCP_PUBLISH__: "false" },
});
