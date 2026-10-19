import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  // What a build without Ayme resolves the package to.
  entry: ["src/index.ts", "src/absent.ts"],
  format: ["esm"],
});
