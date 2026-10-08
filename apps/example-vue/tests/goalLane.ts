import { test, type Locator, type Page } from "@playwright/test";

import {
  recordPublishedTools,
  type RecordingDriver,
} from "@ayme-dev/webmcp/testing";

import { readDecisionProvider } from "../scripts/appEnvironment";
import { recordGoalRun } from "./goalRunRecord";

/** What the goal specs read from a Handover. */
export type Handover = { reason: string; changes?: string };

/**
 * Skip the calling spec file without a model key: the same key the dev
 * server's Decision Endpoint reads, since anyone running a goal brings their
 * own. Otherwise record the published tools, so `pursueGoal` can call one.
 */
export function useGoalLane(lane: string) {
  const skipReason = `${lane} skipped: set AYME_TYPESAFE_API_KEY or AYME_OPENROUTER_API_KEY to your own model key to run it.`;
  const modelKey = readDecisionProvider()?.apiKey;
  // The list reporter prints no skip reason, so say it once before the run.
  if (!modelKey) console.log(`\n${skipReason}\n`);
  test.skip(!modelKey, skipReason);
  test.beforeEach(({ context }) => recordPublishedTools(context));
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
 * Pursue the goal, with the Goal Values in `values` when given; under
 * `pnpm run goals:runs` also record what the run did. `expectedSteps` is the
 * step count of a run that ends `done` as intended, the step that judges the
 * goal met included; the harness reports how often a run ends there.
 */
export async function pursueGoal(
  page: Page,
  goal: string,
  maxSteps: number,
  {
    values,
    expectedSteps,
  }: { values?: Record<string, string | number>; expectedSteps?: number } = {}
) {
  return recordGoalRun(page, test.info(), { goal, expectedSteps }, async () => {
    return (await page.evaluate(
      async (input) => {
        const tool = (
          document.modelContext as unknown as RecordingDriver
        ).tools.find((candidate) => candidate.name === "goal");
        if (!tool) throw new Error("goal tool was not published.");
        return await tool.execute(input);
      },
      { goal, maxSteps, values }
    )) as Handover;
  });
}
