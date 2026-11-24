import type { Agent } from "@ayme-dev/mcp/testing";

import { AppView } from "./appView";
import { expect, test } from "./fixtures";

// E2E: on the dogfood page the Inspector's own Page Object is a Page Object
// Model like any other: an agent lists its tools over ayme MCP, drives the
// panel through them, and the panel shows in the page state.

test.use({ fixturePath: "/dogfood.html", connected: true });

/** Calls a tool over ayme MCP, failing the test when the tool fails. */
async function call(agent: Agent, name: string, input: object) {
  const { text, isError } = await agent.call(name, { ...input });
  expect(isError, text).toBe(false);
}
// The first load compiles the Inspector's Page Object from source, one
// TypeScript Program per class, which takes the dev server a while.
test.setTimeout(90_000);

test("an agent drives the panel through the Inspector's Page Object Tools", async ({
  page,
  agent,
  inspector,
}) => {
  const app = new AppView(page);
  const names = await agent!.pageToolNames();
  expect(names).toEqual(
    expect.arrayContaining([
      "ListPage.addItem",
      "Inspector.open",
      "Navigator.showLens",
      "RunsView.clear",
    ])
  );

  await call(agent!, "Navigator.showLens", {
    id: await app.id("Navigator"),
    args: { name: "Tools" },
  });

  await expect(inspector.navigator.lens("Tools")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect
    .poll(async () =>
      Object.values(await inspector.navigator.tools.listed()).flat()
    )
    .toContain("Navigator.showLens");

  // A search in progress does not stop the agent from opening a run card,
  // and the card's own actions come alive with it.
  await call(agent!, "Navigator.search", {
    id: await app.id("Navigator"),
    args: { query: "addItem" },
  });
  await call(agent!, "Inspector.tool", { name: "ListPage.addItem" });
  await expect(inspector.detail.toolPage.title).toHaveText("ListPage.addItem");
  await expect.poll(() => agent!.pageToolNames()).toContain("RunCard.fillJson");
});

test("an agent finds the forms' actions, and sets a fill_form field to a boolean through one", async ({
  page,
  agent,
  inspector,
}) => {
  const app = new AppView(page);
  const toolNames = () => agent!.pageToolNames();
  const card = "RunCard";
  /** Opens a tool's card and its form, whose tools then list. */
  const openForm = async (tool: string, ...actions: string[]) => {
    await call(agent!, "Inspector.tool", { name: tool });
    await expect.poll(toolNames).toContain(`${card}.openArguments`);
    await call(agent!, `${card}.openArguments`, {
      id: await app.id("RunCard"),
    });
    await expect
      .poll(toolNames)
      .toEqual(expect.arrayContaining([`${card}.fill`, ...actions]));
  };

  // The panel settles before the agent's 1 s action timeout applies.
  await inspector.navigator.showLens("Tools");
  await openForm("fill_form", `FillForm.set`);
  const form = inspector.detail.toolPage.card.fillForm;
  await expect(form.control("Urgent")).not.toBeChecked();
  // The editor's root surrounds the list that stays out of page state.
  const editorId = await app.id("FillForm");
  await call(agent!, `FillForm.set`, {
    id: editorId,
    args: { name: "Urgent", value: true },
  });
  await expect(form.control("Urgent")).toBeChecked();

  await openForm("generate_locator", `LocatorGroups.toggleFromTree`);
  await openForm("goal", `ValueRows.fill`);
});

test("a rooted single instance is preselected and runs from the panel", async ({
  agent,
  inspector,
}) => {
  await call(agent!, "Inspector.tool", { name: "Navigator.search" });
  const card = inspector.detail.toolPage.card;
  await card.openArguments();
  await expect(card.items).toHaveCount(1);
  await expect(card.items).toHaveAttribute("aria-checked", "true");
  await card.run({ query: "ListPage.addItem" });
  await expect(inspector.navigator.searchBox).toHaveValue("ListPage.addItem");
});

test("the page state snapshot gives includes the panel", async ({
  page,
  inspector,
}) => {
  await expect(inspector.panel).toBeVisible();
  const structure = await new AppView(page).structure();
  expect(structure).toMatch(/PanelShell po\d+ "ayme"/);
});

test("the panel's renderings of the page stay out of the page state", async ({
  page,
  inspector,
}) => {
  const app = new AppView(page);
  const snapshot = () => app.structure();

  await inspector.navigator.showLens("Structure");
  await expect(inspector.structure.tree).toBeVisible();
  let structure = await snapshot();
  expect(structure).toContain('button "Structure"');
  expect(structure).not.toContain('tree "Page structure"');

  // Search results carry refs too. Were they in the page state, every look
  // (one every two seconds while the Structure lens shows) would find the
  // previous results and the list would grow until its limit.
  await inspector.navigator.search("Groceries");
  const results = inspector.navigator.searchResults;
  await expect(results).toHaveCount(1);
  structure = await snapshot();
  expect(structure).not.toContain('list "Search results"');
  await page.waitForTimeout(2_500);
  await expect(results).toHaveCount(1);
});
