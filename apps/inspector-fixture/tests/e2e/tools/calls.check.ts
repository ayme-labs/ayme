import { fileURLToPath } from "node:url";

import { directPageObjects } from "@ayme-dev/e2e-tools";
import { expect } from "e2e";

import { testIn } from "../fixtures";
import { build } from "./pageObjects";

// Run by `e2e.tools-check.config.ts`, not by the e2e suite: each `agent.act`
// names one Page Object Tool call, which the scripted executor makes and the
// patched e2e records, and the assertions after it hold on a replay as well.

const test = testIn("inline");

/** The same tools, to ask which can run now: arm 3's agent is listed only those. */
const tools = directPageObjects({
  entry: fileURLToPath(new URL("pageObjects.ts", import.meta.url)),
  build,
});
const runsNow = async (tool: string) =>
  (await tools.ruledOutNow(tool)) === undefined;

test("the e2e suite's Page Objects run as tools, record and replay", async ({
  agent,
  inspector,
  listPage,
}) => {
  const call = (
    what: string,
    tool: string,
    input: object = {},
    // How the scripted executor heals the call when it fails (AYME_E2E_STALE).
    heal?: string
  ) =>
    agent.act(what, {
      params: { tool, input: JSON.stringify(input), ...(heal && { heal }) },
    });

  // The pill learns WebMCP's state a moment after the page opens. A step
  // recorded across that change keeps it as part of its outcome, and a
  // replay that starts after it finds nothing left to prove and asks the
  // executor: wait for it first.
  await expect(await inspector.header.connections.pill.front()).toHaveAttribute(
    "aria-label",
    /, WebMCP /
  );

  await call("show the Model lens", "Navigator_showLens", { name: "Model" });
  await expect(await inspector.navigator.lens("Model").front()).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await call("show the Tools lens", "Navigator_showLens", { name: "Tools" });
  await expect(await inspector.navigator.lens("Tools").front()).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // A call that changes nothing on screen: the recording has no change to
  // check, so the call running again without failing is its proof.
  await call("show the Tools lens again", "Navigator_showLens", {
    name: "Tools",
  });

  await call("open the addItem tool's page", "Inspector_tool", {
    name: "ListPage.addItem",
  });
  await expect(await inspector.detail.toolPage.title.front()).toHaveText(
    "ListPage.addItem"
  );

  await call("fill the run card", "RunCard_fill", { args: { text: "Milk" } });
  await expect(
    await inspector.detail.toolPage.card.field("text").front()
  ).toHaveValue("Milk");

  await call("run the tool with Bread", "RunCard_run", {
    args: { text: "Bread" },
  });
  await expect(await listPage.items.front()).toHaveText(["Bread"]);
  expect(await runsNow("RunCard_run")).toBe(true);
  expect(await runsNow("CollapsedLogo_open")).toBe(false);

  await call(
    "collapse the panel",
    "Inspector_collapse",
    {},
    'button "Collapse inspector"'
  );
  await expect(await inspector.panel.front()).toHaveCount(0);
  expect(await runsNow("CollapsedLogo_open")).toBe(true);
  expect(await runsNow("Navigator_showLens")).toBe(false);
  expect(await runsNow("RunCard_run")).toBe(false);

  await call("open the panel from its logo", "CollapsedLogo_open");
  await expect(await inspector.panel.front()).toBeVisible();
});
