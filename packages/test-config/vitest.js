/**
 * The fast analysis lane shared by every test-owning package: the tests that
 * `pnpm analyze:changed` runs for CRAP coverage and Stryker. See
 * docs/testing.md#change-analysis.
 */
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import { nonProductionPatterns } from "./analysis.js";

/** Tests that never belong to the fast lane, whatever the package runs. */
export const fastLaneExcludes = Object.freeze([
  // Packs and installs the packages: tests packaging, not source.
  "**/packedConsumer.test.ts",
]);

/**
 * Turns a package's Vitest config into its fast-lane config: the same tests
 * without the excluded ones, plus V8 coverage that `--coverage` switches on.
 * The excludes reach each inline Vitest project too, since a config with
 * projects ignores its own top-level `exclude`.
 * V8 rather than Istanbul because Istanbul's counters break code that tests
 * serialize into the browser.
 */
export function defineFastLaneConfig(baseConfig, { exclude = [] } = {}) {
  const excludes = [...configDefaults.exclude, ...fastLaneExcludes, ...exclude];
  const config = mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        exclude: excludes,
        coverage: {
          provider: "v8",
          reportsDirectory: "./coverage/crap",
          reporter: ["json"],
          include: ["src/**/*.{ts,tsx}"],
          exclude: [...nonProductionPatterns],
        },
      },
    })
  );
  // mergeConfig concatenates arrays, so the projects are replaced afterwards.
  if (Array.isArray(config.test?.projects)) {
    config.test.projects = config.test.projects.map((project) =>
      typeof project === "string"
        ? project
        : mergeConfig(project, { test: { exclude: excludes } })
    );
  }
  return config;
}
