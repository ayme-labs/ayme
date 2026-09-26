import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Serves the e2e fixture pages with the built Inspector and runtime. */
export default defineConfig({
  root: here("."),
  // What the Ayme bundler plugin sets when publication is on.
  define: { __AYME_WEBMCP_PUBLISH__: "true" },
  resolve: {
    alias: [
      // The package as it ships: its own React bundled in, its CSS compiled.
      {
        find: /^@ayme-dev\/webmcp-inspector$/,
        replacement: here("../../dist/index.mjs"),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 4291, strictPort: true },
});
