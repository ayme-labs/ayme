import type { Page } from "@playwright/test";
import { pageOfDocument } from "../../page-state/infrastructure";
import {
  createPursueGoalTool,
  type GoalLoopRunResult,
  type GoalLoopRunResultStore,
  type GoalTool,
} from "../application/goalLoop";
import type { GoalLoopDecisionFunction } from "../application/stepDecision";
import { configureGoalLoopOf, decisionFunctionOf } from "./goalLoopStores";
import { goalLoopRunResultKey } from "../domain/goalLoopRunResultKey";

/**
 * The last run's result, kept where the testing entry reads it from the
 * document: tests only. It is a readout of the browser runtime's, never
 * read back by it.
 */
const runResultReadout: GoalLoopRunResultStore = ((
  globalThis as typeof globalThis & {
    [goalLoopRunResultKey]?: GoalLoopRunResultStore;
  }
)[goalLoopRunResultKey] ??= {});

/**
 * Package-internal: the `goal` tool when `goalLoop` is configured on `page`,
 * `null` otherwise. `record` hears each run's result.
 */
export function getPursueGoalToolOf(
  page: Page,
  record: (result: GoalLoopRunResult) => void = () => {}
): GoalTool | null {
  const fn = decisionFunctionOf(page);
  return fn ? createPursueGoalTool(fn, record) : null;
}

/**
 * Package-internal: store or clear the decision function for the current
 * runtime session in the browser. Called by `start()` and `stop()` in
 * `runtime.ts`.
 */
export function configureGoalLoop(
  decisionFn: GoalLoopDecisionFunction | undefined
): void {
  configureGoalLoopOf(pageOfDocument(document), decisionFn);
}

/**
 * Package-internal: returns the `goal` tool when `goalLoop` is
 * configured, `null` otherwise.
 */
export function getPursueGoalTool(): GoalTool | null {
  return getPursueGoalToolOf(pageOfDocument(document), (result) => {
    runResultReadout.last = result;
  });
}
