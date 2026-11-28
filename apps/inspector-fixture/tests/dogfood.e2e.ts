import { describe } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Agent } from "@ayme-dev/mcp/testing";

import { testIn, confirmGoalRecordings } from "./e2e/fixtures";

// E2E: on the dogfood page the Inspector's own Page Object is a Page Object
// Model like any other: an agent lists its tools over ayme MCP, drives the
// panel through them, and the panel shows in the page state.

const test = testIn("inline", "/dogfood.html", { connected: true });

/** Calls a tool over ayme MCP, failing the test when the tool fails. */
async function call(agent: Agent, name: string, input: object) {
  const { text, isError } = await agent.call(name, { ...input });
  if (isError) throw new Error(`${name} failed over ayme MCP: ${text}`);
}

// The first load compiles the Inspector's Page Object from source, one
// TypeScript Program per class, which takes the dev server a while.
describe("dogfood", { timeout: 90_000 }, () => {
  test("an agent drives the panel through the Inspector's Page Object Tools", async ({
    appView,
    mcpServer,
    inspector,
  }) => {
    const agent = mcpServer!;
    const names = await agent.pageToolNames();
    expect(names).toEqual(
      expect.arrayContaining([
        "ListPage.addItem",
        "Inspector.open",
        "Navigator.showLens",
        "RunsView.clear",
      ])
    );

    await call(agent, "Navigator.showLens", {
      id: await appView.id("Navigator"),
      args: { name: "Tools" },
    });

    await expect(
      await inspector.navigator.lens("Tools").front()
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () =>
        Object.values(await inspector.navigator.tools.listed()).flat()
      )
      .toContain("Navigator.showLens");

    // A search in progress does not stop the agent from opening a run card,
    // and the card's own actions come alive with it.
    await call(agent, "Navigator.search", {
      id: await appView.id("Navigator"),
      args: { query: "addItem" },
    });
    await call(agent, "Inspector.tool", { name: "ListPage.addItem" });
    await expect(await inspector.detail.toolPage.title.front()).toHaveText(
      "ListPage.addItem"
    );
    await expect
      .poll(() => agent.pageToolNames())
      .toContain("RunCard.fillJson");
  });

  test("an agent finds the forms' actions, and sets a fill_form field to a boolean through one", async ({
    browser,
    appView,
    mcpServer,
    inspector,
  }) => {
    const mcp = mcpServer!;
    const toolNames = () => mcp.pageToolNames();
    const card = "RunCard";
    /** Opens a tool's card and its form, whose tools then list. */
    const openForm = async (tool: string, ...actions: string[]) => {
      await call(mcp, "Inspector.tool", { name: tool });
      await expect.poll(toolNames).toContain(`${card}.openArguments`);
      await call(mcp, `${card}.openArguments`, {
        id: await appView.id("RunCard"),
      });
      await expect
        .poll(toolNames)
        .toEqual(expect.arrayContaining([`${card}.fill`, ...actions]));
    };

    // The panel settles before the agent's 1 s action timeout applies.
    await inspector.navigator.showLens("Tools");
    await openForm("fill_form", `FillForm.set`);
    const form = inspector.detail.toolPage.card.fillForm;
    await expect(await form.control("Urgent").front()).not.toBeChecked();
    // The editor's root surrounds the list that stays out of page state.
    const editorId = await appView.id("FillForm");
    await call(mcp, `FillForm.set`, {
      id: editorId,
      args: { name: "Urgent", value: true },
    });
    await expect(await form.control("Urgent").front()).toBeChecked();

    await openForm("generate_locator", `LocatorGroups.toggleFromTree`);
    await openForm("goal", `ValueRows.fill`);

    await confirmGoalRecordings(browser);
  });

  test("the page state snapshot gives includes the panel", async ({
    appView,
    inspector,
  }) => {
    await expect(await inspector.panel.front()).toBeVisible();
    const structure = await appView.structure();
    expect(structure).toMatch(/PanelShell po\d+ "ayme"/);
  });

  test("the panel's renderings of the page stay out of the page state", async ({
    browser,
    appView,
    inspector,
  }) => {
    const snapshot = () => appView.structure();

    await inspector.navigator.showLens("Structure");
    await expect(await inspector.structure.tree.front()).toBeVisible();
    let structure = await snapshot();
    expect(structure).toContain('button "Structure"');
    expect(structure).not.toContain('tree "Page structure"');

    // Search results carry refs too. Were they in the page state, every look
    // (one every two seconds while the Structure lens shows) would find the
    // previous results and the list would grow until its limit.
    await inspector.navigator.search("Groceries");
    const results = inspector.navigator.searchResults;
    await expect(await results.front()).toHaveCount(1);
    structure = await snapshot();
    expect(structure).not.toContain('list "Search results"');
    // Over a look: the count must hold, so there is no state to wait for.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await expect(await results.front()).toHaveCount(1);

    await confirmGoalRecordings(browser);
  });
});
