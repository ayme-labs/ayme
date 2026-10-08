/**
 * Stryker settings shared by every test-owning package. Mutants run against
 * the package's fast-lane Vitest config. See docs/testing.md#change-analysis.
 */
import process from "node:process";

/**
 * The fast lane skips static mutants: code that runs when a module loads, such
 * as tool descriptions, has no owning test, so Stryker reruns every test for
 * each one. The full lane, set with `STRYKER_LANE=full`, keeps them.
 */
export function defineStrykerConfig({ mutate } = {}) {
  const full = process.env.STRYKER_LANE === "full";
  return {
    packageManager: "pnpm",
    testRunner: "vitest",
    plugins: ["@stryker-mutator/vitest-runner"],
    vitest: { configFile: "vitest.fast.config.ts", related: true },
    ignoreStatic: !full,
    // Two workers keep a local run light; CI's full lane takes every core.
    ...(full ? {} : { concurrency: 2 }),
    tempDirName: ".stryker-tmp",
    reporters: full ? ["clear-text", "json", "html"] : ["clear-text", "json"],
    htmlReporter: { fileName: "reports/mutation/mutation-full.html" },
    jsonReporter: {
      fileName: full
        ? "reports/mutation/mutation-full.json"
        : "reports/mutation/mutation.json",
    },
    mutate: mutate ?? [
      "src/**/*.{ts,tsx}",
      "!src/**/*.d.ts",
      "!src/**/*.test.{ts,tsx}",
      "!src/**/*.testSupport.{ts,tsx}",
      "!src/**/*.scenario.{ts,tsx}",
      "!src/**/*.setup.{ts,tsx}",
      "!src/**/__tests__/**",
      "!src/**/fixtures/**",
      "!src/**/test-utils/**",
      "!src/**/testing.ts",
      "!src/**/testing/**",
    ],
  };
}
