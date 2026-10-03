import { defineConfig } from "tsdown";

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm"],
  },
  {
    // The Angular CLI loads schematics with require().
    entry: { "schematics/ng-add": "src/schematics/ng-add.ts" },
    format: ["cjs"],
    dts: false,
    deps: { neverBundle: [/^@angular-devkit\//, /^@schematics\//] },
  },
]);
