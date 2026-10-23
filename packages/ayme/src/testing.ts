// The testing entry (ADR-0026): reads the last Goal Loop run's result, the
// per-step scores behind its Handover, which only tests may import.
import type { Page } from "@playwright/test";

import type { GoalLoopRunResult, GoalLoopRunResultStore } from "./goal-loop";
import { goalLoopRunResultKey } from "./goal-loop";

export type { GoalLoopRunResult, GoalLoopStepScore } from "./goal-loop";

type WithStore = typeof globalThis & {
  [goalLoopRunResultKey]?: GoalLoopRunResultStore;
};

/** The last Goal Loop run's result in this document, read in the page. */
export function getLastGoalLoopRunResult(): GoalLoopRunResult | undefined {
  return (globalThis as WithStore)[goalLoopRunResultKey]?.last;
}

/** The last Goal Loop run's result in the page's document, read from Playwright. */
export function readLastGoalLoopRunResult(
  page: Page
): Promise<GoalLoopRunResult | undefined> {
  // Runs in the browser, so it gets the key as an argument.
  return page.evaluate<
    GoalLoopRunResult | undefined,
    typeof goalLoopRunResultKey
  >((key) => (globalThis as WithStore)[key]?.last, goalLoopRunResultKey);
}
