import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Omit build-machine source paths, not copyright or license comments.
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  dts: true,
  // The types name Playwright's own, which a caller has from the
  // project's Playwright: they stay Playwright's, not a copy of them.
  deps: { neverBundle: ["playwright-core"] },
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
});
