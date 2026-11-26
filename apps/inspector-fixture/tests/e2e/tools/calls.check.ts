import { expect } from "e2e";

import { testIn } from "../fixtures";

// Run by `e2e.tools-check.config.ts`, not by the e2e suite: each `agent.act`
// names one Page Object Tool call, which the scripted executor makes and the
// patched e2e records, and the assertions after it hold on a replay as well.

const test = testIn("inline");

test("the e2e suite's Page Objects run as tools, record and replay", async ({
  agent,
  inspector,
  listPage,
}) => {
  const call = (what: string, tool: string, input: object = {}) =>
    agent.act(what, { params: { tool, input: JSON.stringify(input) } });

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

  await call("collapse the panel", "Inspector_collapse");
  await expect(await inspector.panel.front()).toHaveCount(0);

  await call("open the panel from its logo", "CollapsedLogo_open");
  await expect(await inspector.panel.front()).toBeVisible();
});
