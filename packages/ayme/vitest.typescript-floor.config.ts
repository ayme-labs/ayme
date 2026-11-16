import { createRequire } from "node:module";

import { defineConfig } from "vitest/config";

// The compiler's tests on the floor of the TypeScript peer range: the
// compiler runs on the project's own TypeScript.
export default defineConfig({
  resolve: {
    alias: {
      typescript: createRequire(import.meta.url).resolve("typescript-floor"),
    },
  },
  test: {
    name: "compiler on TypeScript 5.4",
    include: ["src/compiler/**/*.test.ts"],
    // Each file builds TypeScript Programs; parallel files contend on CI.
    fileParallelism: false,
  },
});
