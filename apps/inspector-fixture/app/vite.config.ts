import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serves the e2e fixture pages with the built Inspector and runtime: the
 * workspace packages resolve to their `dist`, as they ship.
 */
export default defineConfig({
  root: here("."),
  // The e2e config picks a free port and passes it with --port.
  server: { host: "127.0.0.1", strictPort: true },
});
