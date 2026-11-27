import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

/**
 * Serves the fixture pages with the built runtime: the workspace packages
 * resolve to their `dist`, as they ship.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // ayme stays in every build: the e2e suite drives the fixture's tools.
  plugins: [ayme({ include: true })],
  // The runtime imports WebMCP publication only once the session starts.
  // Found that late, Vite would optimize its dependencies and reload the
  // page. Forced, so a rebuilt package is never served from a stale cache.
  optimizeDeps: {
    include: ["@ayme-dev/webmcp"],
    exclude: ["@ayme-dev/ayme"],
    force: true,
  },
  // The e2e config picks a free port and passes it with --port.
  server: { host: "127.0.0.1", strictPort: true },
});
