import { expect, test } from "@playwright/test";

import {
  activeItems,
  archivedItems,
  itemIds,
  pursueGoal,
  useGoalLane,
} from "./goalLane";

/** The run harness's own goal set (`playwright.harness.config.ts`): goals
 *  measured by `pnpm run goals:runs` and allowed to fail. CI never runs them. */
useGoalLane("Harness goal set");

test("archive Review onboarding flow", async ({ page }) => {
  await page.goto("/");
  await expect(activeItems(page)).toHaveCount(2);
  const [reviewId] = await itemIds(
    activeItems(page).filter({ hasText: "Review onboarding flow" })
  );

  // Expected: one step archives the item, the next judges the goal met.
  const handover = await pursueGoal(
    page,
    "archive Review onboarding flow",
    5,
    2
  );

  expect(handover.reason).toBe("done");
  expect(await itemIds(archivedItems(page))).toEqual([reviewId]);
  expect(await itemIds(activeItems(page))).not.toContain(reviewId);
});
