import {
  createPursueGoalTool,
  type GoalLoopRunResultStore,
  type GoalTool,
} from "../application/goalLoop";
import type { GoalLoopDecisionFunction } from "../application/stepDecision";
import { goalLoopRunResultKey } from "../domain/goalLoopRunResultKey";

// The stores live on globalThis, so every copy of the bundle in one page
// shares them.

type GoalLoopStore = { decisionFn?: GoalLoopDecisionFunction };

const goalLoopStore: GoalLoopStore = ((
  globalThis as typeof globalThis & {
    __aymeGoalLoopStore?: GoalLoopStore;
  }
).__aymeGoalLoopStore ??= {});

/** Where the last run's result is kept; the testing entry reads it. */
const runResultStore: GoalLoopRunResultStore = ((
  globalThis as typeof globalThis & {
    [goalLoopRunResultKey]?: GoalLoopRunResultStore;
  }
)[goalLoopRunResultKey] ??= {});

/**
 * Package-internal: store or clear the decision function for the current
 * runtime session. Called by `start()` and `stop()` in `runtime.ts`.
 */
export function configureGoalLoop(
  decisionFn: GoalLoopDecisionFunction | undefined
): void {
  goalLoopStore.decisionFn = decisionFn;
}

/**
 * Package-internal: returns the `goal` tool when `goalLoop` is
 * configured, `null` otherwise.
 */
export function getPursueGoalTool(): GoalTool | null {
  const fn = goalLoopStore.decisionFn;
  if (!fn) return null;
  return createPursueGoalTool(fn, (result) => {
    runResultStore.last = result;
  });
}
