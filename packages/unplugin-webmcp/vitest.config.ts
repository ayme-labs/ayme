import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Each file creates TypeScript programs; parallel files contend on CI runners.
    fileParallelism: false,
    // Each test builds its own TypeScript program, which takes 5-17 s on CI
    // while Turbo runs the browser suites and the packed-consumer test beside
    // it.
    testTimeout: 60_000,
  },
});
