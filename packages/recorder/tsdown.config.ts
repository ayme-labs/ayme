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
  },
  format: ["esm"],
  platform: "node",
});
