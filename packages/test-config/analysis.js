/**
 * What the change analysis treats as production source: the one list that
 * Stryker's mutate globs, the fast lane's coverage excludes and
 * `scripts/analyze-changed.mjs` all derive from. See
 * docs/testing.md#change-analysis.
 */
import path from "node:path";

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

/** Whether a repository path (`packages/<name>/src/...`) is production source. */
export function isProductionSource(repoPath) {
  return (
    path.posix.matchesGlob(repoPath, "packages/*/src/**/*.{ts,tsx}") &&
    !nonProductionPatterns.some((pattern) =>
      path.posix.matchesGlob(repoPath, pattern)
    )
  );
}
