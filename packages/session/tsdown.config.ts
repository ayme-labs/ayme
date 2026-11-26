import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  dts: true,
  // The front door: what the CLI runs.
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
});
