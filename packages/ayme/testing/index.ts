// Test support (ADR-0057) for ayme's own browser tests: reads the last Goal
// Loop run's result in the document the test runs in.
import type {
  GoalLoopRunResult,
  GoalLoopRunResultStore,
} from "../src/goal-loop/application";
import { goalLoopRunResultKey } from "../src/goal-loop/domain";

type WithStore = typeof globalThis & {
  [goalLoopRunResultKey]?: GoalLoopRunResultStore;
};

/** The last Goal Loop run's result in this document, read in the page. */
export function getLastGoalLoopRunResult(): GoalLoopRunResult | undefined {
  return (globalThis as WithStore)[goalLoopRunResultKey]?.last;
}
