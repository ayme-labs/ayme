import { selectors, test, type Locator, type Page } from "@playwright/test";

import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/ayme/testing";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

import { readModelKey } from "../scripts/appEnvironment";
import { recordGoalRun } from "./goalRunRecord";

/** What the goal specs read from a Handover. */
export type Handover = { reason: string; changes?: string };

/**
 * Skip the calling spec file without a model key: the same key the dev
 * server's Decision Endpoint reads, since anyone running a goal brings their
 * own. Otherwise record the published tools, so `pursueGoal` can call one,
 * and register the selector engine `openWithInspectorCollapsed` needs.
 */
export function useGoalLane(lane: string) {
  const skipReason = `${lane} skipped: set AYME_OPENROUTER_API_KEY to your own model key to run it.`;
  const modelKey = readModelKey();
  // The list reporter prints no skip reason, so say it once before the run.
  if (!modelKey) console.log(`\n${skipReason}\n`);
  test.skip(!modelKey, skipReason);
  test.beforeAll(() => registerInspectorSelectors(selectors));
  test.beforeEach(({ context }) => recordPublishedTools(context));
}

/**
 * Opens the playground with the Inspector collapsed. The panel paints above
 * the page's own UI, so at its default place it covers the archive dialog's
 * confirm button (#272). Needs `registerInspectorSelectors` first.
 */
export async function openWithInspectorCollapsed(page: Page) {
  await page.goto("/");
  await new Inspector(page).collapse();
}

export function activeItems(page: Page) {
  return page.getByRole("list", { name: "Active items" }).getByRole("listitem");
}

export function archivedItems(page: Page) {
  return page
    .getByRole("list", { name: "Archived items" })
    .getByRole("listitem");
}

/** Both lists show the item id, so it identifies the same item in either. */
export function itemIds(items: Locator) {
  return items.locator("code").allInnerTexts();
}

/**
 * Pursue the goal; under `pnpm run goals:runs` also record what the run did.
 * `expectedSteps` is the step count of a run that ends `done` as intended,
 * the step that judges the goal met included; the harness reports how often
 * a run ends there.
 */
export async function pursueGoal(
  page: Page,
  goal: string,
  maxSteps: number,
  expectedSteps?: number
) {
  return recordGoalRun(page, test.info(), { goal, expectedSteps }, async () => {
    return (await page.evaluate(
      async ({ goal, maxSteps }) => {
        const tool = (
          document.modelContext as unknown as RecordingDriver
        ).tools.find((candidate) => candidate.name === "goal");
        if (!tool) throw new Error("goal tool was not published.");
        return await tool.execute({ goal, maxSteps });
      },
      { goal, maxSteps }
    )) as Handover;
  });
}
