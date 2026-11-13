import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  entry: { index: "src/app/index.ts" },
  format: ["esm"],
});
