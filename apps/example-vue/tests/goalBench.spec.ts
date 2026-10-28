import { expect, test } from "@playwright/test";
import { waitForPublishedTool } from "@ayme-dev/webmcp/testing";

import {
  benchGoals,
  expectedStepsOf,
  expectedTargetsOf,
  openBenchPage,
} from "./benchGoals";
import { pursueGoal, useGoalLane } from "./goalLane";

/** The bench goal set (`playwright.bench.config.ts`): goals on pages without
 *  Page Objects, measured by `pnpm run goals:runs --goal-set bench` and
 *  allowed to fail. CI never runs them. */
useGoalLane("Bench goal set");

for (const bench of benchGoals) {
  test(bench.title, async ({ page }) => {
    await openBenchPage(page, bench);
    await waitForPublishedTool(page, "goal");

    const handover = await pursueGoal(page, bench.goal, bench.maxSteps, {
      values: bench.values,
      expectedSteps: expectedStepsOf(bench),
      expectedTargets: expectedTargetsOf(bench),
    });

    expect(handover.reason).toBe(bench.reason);
    if (bench.intended.length === 0) expect(handover.history).toEqual([]);
    await bench.outcome(page);
  });
}
