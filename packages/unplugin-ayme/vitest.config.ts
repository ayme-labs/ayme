import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Each file creates TypeScript programs; parallel files contend on CI runners.
    fileParallelism: false,
    // Tests build TypeScript programs, which run several times slower on CI
    // while Turbo runs the browser suites and the packed-consumer test beside
    // them.
    testTimeout: 15_000,
  },
});
