import { defineFastLaneConfig } from "@ayme-dev/test-config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

import baseConfig from "./vitest.config";

/**
 * Runs the fastest test files first. A mutation run stops at a mutant's
 * first failing test, so the order of its covering files decides what the
 * mutant costs. Vitest's own order runs the slowest first once it has their
 * times, as it has after a mutation run's first run: a mutant of the
 * lifecycle would wait out the real time limits of startRecorder.test.ts
 * before its own table test killed it in a millisecond.
 */
class FastestFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    const duration = (file: TestSpecification) =>
      this.ctx.cache.getTestSpecificationResult(file)?.duration ?? 0;
    return [...files].sort((a, b) => duration(a) - duration(b));
  }
}

// The unit tests: what a mutation run runs. The coverage behind the CRAP
// score also counts the contract suite (vitest.crap.config.ts).
export default defineFastLaneConfig(
  mergeConfig(
    baseConfig,
    defineConfig({ test: { sequence: { sequencer: FastestFirst } } })
  )
);
