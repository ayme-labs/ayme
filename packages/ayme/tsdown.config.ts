import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  copy: ["THIRD_PARTY_NOTICES.txt"],
  deps: {
    alwaysBundle: ["@ayme-dev/playwright-lite", "@ayme-dev/core"],
  },
  dts: true,
  entry: [
    "src/index.ts",
    "src/internal.ts",
    "src/server.ts",
    // The last Goal Loop run's result, for tests only (ADR-0026).
    "src/testing.ts",
  ],
  format: ["esm"],
});
