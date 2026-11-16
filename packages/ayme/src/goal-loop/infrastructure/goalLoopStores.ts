// The decision function of a runtime session, kept per Page (ADR-0049): the
// browser runtime's is that of its own Playwright Lite page.
import type { Page } from "@playwright/test";
import type { GoalLoopDecisionFunction } from "../application/stepDecision";

const decisionFns = new WeakMap<Page, GoalLoopDecisionFunction>();

/**
 * Package-internal: store or clear the decision function for the runtime
 * session on `page`.
 */
export function configureGoalLoopOf(
  page: Page,
  decisionFn: GoalLoopDecisionFunction | undefined
): void {
  if (decisionFn) decisionFns.set(page, decisionFn);
  else decisionFns.delete(page);
}

/** Package-internal: the decision function configured on `page`, if any. */
export function decisionFunctionOf(
  page: Page
): GoalLoopDecisionFunction | undefined {
  return decisionFns.get(page);
}
