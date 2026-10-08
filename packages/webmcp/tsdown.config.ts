import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  dts: true,
  entry: {
    // What `@ayme-dev/ayme` loads for the `webMCP` option.
    index: "src/index.ts",
    // The recording WebMCP driver, for tests only (ADR-0026).
    testing: "src/testing.ts",
  },
  format: ["esm"],
});
