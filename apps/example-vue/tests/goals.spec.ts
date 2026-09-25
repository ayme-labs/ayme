import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { loadEnv } from "vite";

import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/webmcp/testing";

type Handover = { reason: string };

/** Read the same key the dev server's Decision Endpoint reads: anyone running
 *  this lane brings their own. */
const modelKey = loadEnv(
  "development",
  fileURLToPath(new URL("..", import.meta.url)),
  ""
).AYME_OPENROUTER_API_KEY;

const skipReason =
  "Live goal lane skipped: set AYME_OPENROUTER_API_KEY to your own model key to run it.";

// The list reporter prints no skip reason, so say it once before the run.
if (!modelKey) console.log(`\n${skipReason}\n`);
test.skip(!modelKey, skipReason);

test.beforeEach(({ context }) => recordPublishedTools(context));

function activeItems(page: Page) {
  return page.getByRole("list", { name: "Active items" }).getByRole("listitem");
}

function archivedItems(page: Page) {
  return page
    .getByRole("list", { name: "Archived items" })
    .getByRole("listitem");
}

/** Both lists show the item id, so it identifies the same item in either. */
function itemIds(items: Locator) {
  return items.locator("code").allInnerTexts();
}

async function pursueGoal(page: Page, goal: string, maxSteps: number) {
  return (await page.evaluate(
    async ({ goal, maxSteps }) => {
      const tool = (
        document.modelContext as unknown as RecordingDriver
      ).tools.find((candidate) => candidate.name === "pursue_goal");
      if (!tool) throw new Error("pursue_goal tool was not published.");
      return await tool.execute({ goal, maxSteps });
    },
    { goal, maxSteps }
  )) as Handover;
}

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
});
