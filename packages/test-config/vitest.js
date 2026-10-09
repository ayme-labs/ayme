/**
 * The fast analysis lane shared by every test-owning package: the tests that
 * `pnpm analyze:changed` runs for CRAP coverage and Stryker. See
 * docs/testing.md#change-analysis.
 */
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

/** Tests that never belong to the fast lane, whatever the package runs. */
export const fastLaneExcludes = Object.freeze([
  // Packs and installs the packages: tests packaging, not source.
  "**/packedConsumer.test.ts",
]);

/** Source that is not production code, so it gets no CRAP score. */
const coverageExcludes = [
  "**/*.d.ts",
  "**/*.test.{ts,tsx}",
  "**/*.testSupport.{ts,tsx}",
  "**/*.scenario.{ts,tsx}",
  "**/*.setup.{ts,tsx}",
  "**/__tests__/**",
  "**/fixtures/**",
  "**/test-utils/**",
  "**/testing.ts",
  "**/testing/**",
];

/**
 * Turns a package's Vitest config into its fast-lane config: the same tests
 * without the excluded ones, plus V8 coverage that `--coverage` switches on.
 * V8 rather than Istanbul because Istanbul's counters break code that tests
 * serialize into the browser.
 */
export function defineFastLaneConfig(baseConfig, { exclude = [] } = {}) {
  return mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        exclude: [...configDefaults.exclude, ...fastLaneExcludes, ...exclude],
        coverage: {
          provider: "v8",
          reportsDirectory: "./coverage/crap",
          reporter: ["json"],
          include: ["src/**/*.{ts,tsx}"],
          exclude: coverageExcludes,
        },
      },
    })
  );
}
