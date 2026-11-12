import { expect, test, type Locator, type Page } from "@playwright/test";

import { connectPage, freePort, startAgent } from "@ayme-dev/mcp/testing";

import { readDecisionProvider } from "../scripts/appEnvironment";
import { recordGoalRun } from "./goalRunRecord";

/** What the goal specs read from a Handover. */
export type Handover = {
  reason: string;
  history: unknown[];
  changes?: string;
};

/**
 * The `ayme mcp --browser-tools` servers the goal specs started, by the page
 * each one is paired with. WebMCP publishes no `goal`, so a spec pursues a
 * goal through its server, as a coding agent does.
 */
const agents = new Map<Page, Awaited<ReturnType<typeof startAgent>>>();
test.afterEach(async () => {
  await Promise.all([...agents.values()].map((agent) => agent.close()));
  agents.clear();
});

/** Opens `path`, paired with an `ayme mcp --browser-tools` server. */
export async function openPaired(page: Page, path: string) {
  const agent = await startAgent(
    "--port",
    String(await freePort()),
    "--browser-tools"
  );
  agents.set(page, agent);
  const baseURL = test.info().project.use.baseURL!;
  await connectPage(agent, page, new URL(path, baseURL).href, {
    timeout: 45_000,
  });
}

/** Waits until the page's server lists the tool `name`, such as `goal`. */
export async function waitForAgentTool(page: Page, name: string) {
  const agent = agents.get(page)!;
  await expect
    .poll(() => agent.pageToolNames(), { message: agent.log })
    .toContain(name);
}

/**
 * Skip the calling spec file without a model key: the same key the dev
 * server's Decision Endpoint reads, since anyone running a goal brings their
 * own.
 */
export function useGoalLane(lane: string) {
  const skipReason = `${lane} skipped: set AYME_TYPESAFE_API_KEY or AYME_OPENROUTER_API_KEY to your own model key to run it.`;
  const modelKey = readDecisionProvider()?.apiKey;
  // The list reporter prints no skip reason, so say it once before the run.
  if (!modelKey) console.log(`\n${skipReason}\n`);
  test.skip(!modelKey, skipReason);
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
 * `expectedTargets` names, per Goal Value label, the element a `fill` or
 * `type` of that value should target, as the loop describes elements (`role
 * "name"`); the harness counts the steps that targeted another.
 */
export async function pursueGoal(
  page: Page,
  goal: string,
  maxSteps: number,
  {
    values,
    expectedSteps,
    expectedTargets,
  }: {
    values?: Record<string, string | number>;
    expectedSteps?: number;
    expectedTargets?: Record<string, string>;
  } = {}
) {
  return recordGoalRun(
    page,
    test.info(),
    { goal, expectedSteps, expectedTargets },
    async () => {
      const { text, isError } = await agents
        .get(page)!
        .call("goal", { goal, maxSteps, ...(values && { values }) });
      if (isError) throw new Error(`goal failed: ${text}`);
      return JSON.parse(text) as Handover;
    }
  );
}
