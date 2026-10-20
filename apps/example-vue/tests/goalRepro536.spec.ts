import { expect, test } from "@playwright/test";
import { waitForPublishedTool } from "@ayme-dev/webmcp/testing";

import {
  expectedStepsOf,
  expectedTargetsOf,
  openBenchPage,
} from "./benchGoals";
import { pursueGoal, useGoalLane } from "./goalLane";
import { repro536Goals } from "./repro536Goals";

/** The repro goal set for issue 536 (`playwright.repro536.config.ts`),
 *  measured by `pnpm run goals:runs --goal-set repro536` and allowed to
 *  fail. CI never runs it. */
useGoalLane("Issue 536 repro goal set");

for (const bench of repro536Goals) {
  test(bench.title, async ({ page }) => {
    await openBenchPage(page, bench);
    await waitForPublishedTool(page, "goal");

    const handover = await pursueGoal(page, bench.goal, bench.maxSteps, {
      values: bench.values,
      expectedSteps: expectedStepsOf(bench),
      expectedTargets: expectedTargetsOf(bench),
    });

    expect(handover.reason).toBe(bench.reason);
    await bench.outcome(page);
  });
}
