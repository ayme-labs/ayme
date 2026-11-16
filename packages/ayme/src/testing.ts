// The testing entry (ADR-0026): reads the last Goal Loop run's result, the
// per-step scores behind its Handover, and names the bars the Step Decision
// stops on, which only tests may import.
import type { Page } from "@playwright/test";

import type {
  GoalLoopRunResult,
  GoalLoopRunResultStore,
} from "./goal-loop/application";
import { goalLoopRunResultKey } from "./goal-loop/domain";

export type {
  GoalLoopRunResult,
  GoalLoopStepScore,
} from "./goal-loop/application";
export { DONE_BAR, LOWER_BAR } from "./goal-loop/application";
// The in-page module over the Playwright Lite page of the document a test's
// own runtime runs in, which a Node host's `./playwright` entry cannot be
// bundled for.
export { inPage } from "./in-page";

// The Inspector contract's runtime side, which the Inspector's tests stand a
// session in with (ADR-0049): the product's `./inspector` entry has none of it.
export { createHighlights, createInspectorContract } from "./runtime";
export type {
  Highlightable,
  InspectorContractPorts,
  InspectorSession,
} from "./runtime";

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
