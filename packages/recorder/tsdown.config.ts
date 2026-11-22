import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  dts: true,
  entry: {
    // The front door: what the CLI starts.
    index: "src/index.ts",
    // The plain data shared with the window, which imports nothing else of
    // the engine.
    contract: "src/contract/index.ts",
    // Test-only helpers (ADR-0026): a recorder on a scripted browser.
    testing: "src/testing/index.ts",
  },
  format: ["esm"],
  platform: "node",
});
