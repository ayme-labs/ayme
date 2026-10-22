import { defineConfig } from "tsdown";

// Private workspace packages, copied into the output instead of imported.
const bundled = ["@ayme-dev/playwright-lite", "@ayme-dev/core"];

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  copy: ["THIRD_PARTY_NOTICES.txt"],
  deps: {
    alwaysBundle: bundled,
    // The declarations also copy in the page client's types they name, such
    // as its not-connected reasons, so they never import the optional
    // `@ayme-dev/mcp`. This list replaces the one above for declarations.
    dts: { alwaysBundle: [...bundled, "@ayme-dev/mcp/client"] },
  },
  dts: true,
  entry: [
    "src/index.ts",
    "src/internal.ts",
    // What a Build without Ayme resolves the two entries above to.
    "src/absent.ts",
    "src/server.ts",
    // The last Goal Loop run's result, for tests only (ADR-0026).
    "src/testing.ts",
  ],
  format: ["esm"],
});
