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
 * Production source that a folder sends to another measure than a mutation
 * run and a CRAP score: the code in it cannot be measured the usual way. A
 * folder decides, under a layer's `infrastructure/`, so a new file gets its
 * treatment from where it is put. `how` is what the change-analysis report
 * says of it. See docs/testing.md#code-a-real-browser-runs.
 */
export const measuredOtherwise = Object.freeze([
  Object.freeze({
    pattern: "**/infrastructure/live/**",
    mutated: false,
    scored: true,
    how: "drives a real browser from Node: not mutated; its contract suite on every supported Playwright version is its measure, and that suite's coverage counts in its CRAP score",
  }),
  Object.freeze({
    pattern: "**/infrastructure/in-page/**",
    mutated: false,
    scored: false,
    how: "runs in the page, where Node's coverage cannot see it: neither mutated nor scored; a lint complexity cap keeps it trivial, and the rules it decides by are plain logic outside the folder",
  }),
]);

/** Production source a mutation run leaves alone. */
export const notMutatedPatterns = Object.freeze(
  measuredOtherwise
    .filter((group) => !group.mutated)
    .map((group) => group.pattern)
);

/** Production source the CRAP score leaves out. */
export const notScoredPatterns = Object.freeze(
  measuredOtherwise
    .filter((group) => !group.scored)
    .map((group) => group.pattern)
);

const groupMatchers = measuredOtherwise.map((group) => ({
  group,
  matches: picomatch(group.pattern),
}));

/** The group of `measuredOtherwise` a repository path is in, if any. */
export function measuredOtherwiseGroup(repoPath) {
  return groupMatchers.find(({ matches }) => matches(repoPath))?.group;
}

/** Whether a mutation run mutates a production source file. */
export function isMutated(repoPath) {
  return measuredOtherwiseGroup(repoPath)?.mutated ?? true;
}

/** Whether the CRAP score scores a production source file. */
export function isScored(repoPath) {
  return measuredOtherwiseGroup(repoPath)?.scored ?? true;
}

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
