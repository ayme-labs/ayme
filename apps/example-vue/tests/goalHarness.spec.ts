import { expect, test } from "@playwright/test";
import { waitForPublishedTool } from "@ayme-dev/webmcp/testing";

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
  const handover = await pursueGoal(page, "archive Review onboarding flow", 5, {
    expectedSteps: 2,
  });

  expect(handover.reason).toBe("done");
  expect(await itemIds(archivedItems(page))).toEqual([reviewId]);
  expect(await itemIds(activeItems(page))).not.toContain(reviewId);
});

// Issue 1059: the Create button says the menu is closed only through
// `aria-expanded="false"`, which the page state does not carry (issue 1061).
// The run may open the menu and end `done`, or hand back that it cannot tell,
// `unverified`; a `done` with the menu closed is a false done.
test("the top bar's Create menu is open, while it is closed", async ({
  page,
}) => {
  await page.goto("/harness/create-menu");
  const menu = page.getByRole("menu", { name: "Create" });
  await expect(page.getByRole("button", { name: "Create" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await waitForPublishedTool(page, "TopBar.openCreateMenu");

  // Expected: one step opens the menu, the next judges the goal met.
  const handover = await pursueGoal(
    page,
    "The top bar's Create menu is open.",
    2,
    { expectedSteps: 2 }
  );

  const menuOpen = await menu.isVisible();
  expect(handover.reason, `The menu is ${menuOpen ? "open" : "closed"}`).toBe(
    menuOpen ? "done" : "unverified"
  );
});
