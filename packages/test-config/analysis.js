/**
 * What the change analysis treats as production source: the one list that
 * Stryker's mutate globs, the fast lane's coverage excludes and
 * `scripts/analyze-changed.mjs` all derive from. See
 * docs/testing.md#change-analysis.
 */
import picomatch from "picomatch";

/** Source under `src/` that is not production code, so it gets no score. */
export const nonProductionPatterns = Object.freeze([
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
]);

/**
 * Whether a repository path (`packages/<name>/src/...`) is production source.
 * picomatch is the matcher behind Vitest's coverage globs, so it agrees with
 * them on every platform; Node's own `path.matchesGlob` ignores case on macOS.
 */
export function isProductionSource(repoPath) {
  return isProduction(repoPath);
}

const isProduction = picomatch("packages/*/src/**/*.{ts,tsx}", {
  ignore: [...nonProductionPatterns],
});
