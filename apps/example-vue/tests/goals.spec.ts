import { expect, test } from "@playwright/test";

import {
  activeItems,
  archivedItems,
  itemIds,
  pursueGoal,
  useGoalLane,
} from "./goalLane";

/** The live lane (`test:goals`): goals CI expects to pass. Goals allowed to
 *  fail belong to the run harness's own set, `goalHarness.spec.ts`. */
useGoalLane("Live goal lane");

test("a goal that names a value the model cannot choose hands over", async ({
  page,
}) => {
  await page.goto("/");
  await expect(activeItems(page)).toHaveCount(2);
  const itemsBefore = await activeItems(page).allInnerTexts();

  const handover = await pursueGoal(page, "Add an item called Milk", 5);

  expect(handover.reason).toBe("needs_value");
  expect(await activeItems(page).allInnerTexts()).toEqual(itemsBefore);
});

test("a goal that names a collection instance archives it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(activeItems(page)).toHaveCount(2);
  const [firstId, secondId] = await itemIds(activeItems(page));

  const handover = await pursueGoal(
    page,
    "Archive the second item in the list",
    6
  );

  expect(handover.reason).toBe("done");
  expect(await itemIds(activeItems(page))).toEqual([firstId]);
  expect(await itemIds(archivedItems(page))).toEqual([secondId]);
  // The run's net Change Record shows the item leaving one list for the other.
  expect(handover.changes).toContain(secondId!);
});
