import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

/**
 * Serves the fixture page with the built runtime and page client: the
 * workspace packages resolve to their `dist`, as they ship.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [ayme()],
  // The runtime imports the page client, WebMCP publication and the
  // Inspector only once the session starts. Found that late, Vite would optimize their dependencies
  // and reload the page, after the client already took the connect link
  // from the address bar. Forced, so a rebuilt package is never served from
  // a stale cache. The runtime stays out of the Inspector's bundle, so both
  // share the page's one runtime and its started session.
  optimizeDeps: {
    include: [
      "@ayme-dev/mcp/client",
      "@ayme-dev/webmcp",
      "@ayme-dev/inspector",
    ],
    exclude: ["@ayme-dev/ayme"],
    force: true,
  },
  // The e2e config picks a free port and passes it with --port. The tests
  // also open the page as `ayme.test`, a host that is not localhost.
  server: { host: "127.0.0.1", strictPort: true, allowedHosts: ["ayme.test"] },
});
