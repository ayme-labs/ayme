import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serves the e2e fixture pages with the built Inspector and runtime: the
 * workspace packages resolve to their `dist`, as they ship. The Ayme plugin
 * compiles and registers the Page Objects in `pom/`, the way an app's are.
 * The one exception is the Inspector's own Page Object, which the dogfood
 * page registers: it resolves to the Inspector's source, so the plugin
 * compiles it too; the shipped testing entry carries no compiler output.
 */
export default defineConfig({
  root: here("."),
  resolve: {
    alias: {
      "@ayme-dev/inspector/testing": here(
        "../../../packages/inspector/src/testing/index.ts"
      ),
    },
  },
  // No `inspector: true`: startAyme mounts the Inspector itself, so the page
  // can report a mount that throws.
  plugins: [ayme()],
  // The e2e config picks a free port and passes it with --port.
  server: { host: "127.0.0.1", strictPort: true },
});
