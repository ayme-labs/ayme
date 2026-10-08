/**
 * Stryker settings shared by every test-owning package. Mutants run against
 * the package's fast-lane Vitest config. See docs/testing.md#change-analysis.
 */
import fs from "node:fs";
import process from "node:process";

/**
 * The fast lane skips static mutants: code that runs when a module loads, such
 * as tool descriptions, has no owning test, so Stryker reruns every test for
 * each one. The full lane, set with `STRYKER_LANE=full`, keeps them.
 */
export function defineStrykerConfig({ mutate = defaultMutate } = {}) {
  const full = process.env.STRYKER_LANE === "full";
  const shard = full ? parseShard(process.env.STRYKER_SHARD) : undefined;
  const suffix = shard ? `-${shard.index}-of-${shard.count}` : "";
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
    htmlReporter: { fileName: `reports/mutation/mutation-full${suffix}.html` },
    jsonReporter: {
      fileName: full
        ? `reports/mutation/mutation-full${suffix}.json`
        : "reports/mutation/mutation.json",
    },
    mutate: shard ? shardFiles(mutate, shard) : mutate,
  };
}

const defaultMutate = [
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
];

/**
 * `STRYKER_SHARD=2/4` splits the full lane of a slow package across CI jobs:
 * this job mutates every fourth file, starting with the second.
 */
function parseShard(value) {
  if (!value) return undefined;
  const [index, count] = value.split("/").map(Number);
  if (!(count >= 1 && index >= 1 && index <= count)) {
    throw new Error(`STRYKER_SHARD must look like 2/4, got "${value}"`);
  }
  return count > 1 ? { index, count } : undefined;
}

function shardFiles(patterns, { index, count }) {
  const include = patterns.filter((pattern) => !pattern.startsWith("!"));
  const exclude = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  return fs
    .globSync(include, { exclude })
    .sort()
    .filter((_, i) => i % count === index - 1);
}
