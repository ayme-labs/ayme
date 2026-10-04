import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serves the e2e fixture pages with the built Inspector and runtime: the
 * workspace packages resolve to their `dist`, as they ship. The Ayme plugin
 * compiles and registers the Page Objects in `pom/`, the way an app's are.
 */
export default defineConfig({
  root: here("."),
  // No `inspector: true`: startAyme mounts the Inspector itself, so the page
  // can report a mount that throws.
  plugins: [ayme()],
  // The e2e config picks a free port and passes it with --port.
  server: { host: "127.0.0.1", strictPort: true },
});
