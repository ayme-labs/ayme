import { fileURLToPath } from "node:url";

import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serves the e2e fixture pages with the built Inspector and runtime: the
 * workspace packages resolve to their `dist`, as they ship. The ayme plugin
 * compiles and registers the Page Objects in `ayme/pom/`, the way an app's are.
 * The one exception is the Inspector's own Page Object, which the dogfood
 * page registers: test support resolves to source (ADR-0057), and
 * `ayme/pom/Inspector.ts` reaches it by a relative path, so the plugin
 * compiles it too.
 */
export default defineConfig({
  root: here("."),
  // No `inspector: true`: startAyme mounts the Inspector itself, so the page
  // can report a mount that throws.
  // ayme stays in every build: the e2e suite drives the fixture's tools.
  plugins: [ayme({ include: true })],
  // The e2e config picks a free port and passes it with --port.
  server: { host: "127.0.0.1", strictPort: true },
});
