import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * A strict Content Security Policy, as a site that allows scripts and
 * connections only to its own origin sends.
 */
const STRICT_CSP = "script-src 'self'; connect-src 'self'";

/** Serves any page whose URL has `?strict-csp` with {@link STRICT_CSP}. */
function strictCsp(): Plugin {
  return {
    name: "mcp-fixture-strict-csp",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          new URL(request.url ?? "/", "http://fixture").searchParams.has(
            "strict-csp"
          )
        )
          response.setHeader("content-security-policy", STRICT_CSP);
        next();
      });
    },
  };
}

/**
 * Serves the fixture page with the built runtime and page client: the
 * workspace packages resolve to their `dist`, as they ship. `?strict-csp`
 * serves a page with a strict Content Security Policy.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Ayme stays in every build: the e2e suite drives the fixture's tools.
  plugins: [ayme({ include: true }), strictCsp()],
  // The runtime imports the page client, WebMCP publication and the
  // Inspector only once the session starts. Found that late, Vite would
  // optimize their dependencies and reload the page, after the client already
  // took the connect link from the address bar. Forced, so a rebuilt package
  // is never served from a stale cache. The runtime stays out of the
  // Inspector's bundle, so both share the page's one runtime and its started
  // session.
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
