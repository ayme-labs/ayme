import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  deps: {
    neverBundle: ["@playwright/test"],
  },
  entry: ["src/vite.ts", "src/turbopack-loader.ts", "src/angular.ts"],
  format: ["esm"],
});
