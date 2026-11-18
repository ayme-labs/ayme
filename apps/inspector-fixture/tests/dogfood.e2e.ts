import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { testIn } from "./e2e/fixtures";

// E2E: on the dogfood page the Inspector's own Page Object is a Page Object
// Model like any other: an agent lists its tools, drives the panel through
// them, and sees the panel in the page state.

const test = testIn("inline", "/dogfood.html");

// The first load compiles the Inspector's Page Object from source, one
// TypeScript Program per class, which takes the dev server a while.
describe("dogfood", { timeout: 90_000 }, () => {
  test("an agent drives the panel through the Inspector's Page Object Tools", async ({
    agentView,
    inspector,
  }) => {
    const names = (await agentView.tools()).map(({ name }) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ListPage.addItem",
        "Inspector.open",
        "Navigator.showLens",
        "RunsView.clear",
      ])
    );

    await agentView.call("Navigator.showLens", {
      ref: await agentView.ref('navigation "Navigator"'),
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
    await agentView.call("Navigator.search", {
      ref: await agentView.ref('navigation "Navigator"'),
      args: { query: "addItem" },
    });
    await agentView.call("Inspector.tool", { name: "ListPage.addItem" });
    await expect(await inspector.detail.toolPage.title.front()).toHaveText(
      "ListPage.addItem"
    );
    await expect
      .poll(async () => (await agentView.tools()).map(({ name }) => name))
      .toContain("RunCard.fillJson");
  });

  test("an agent finds the forms' actions, and sets a fill_form field to a boolean through one", async ({
    agentView,
    inspector,
  }) => {
    const toolNames = async () =>
      (await agentView.tools()).map(({ name }) => name);
    const card = "RunCard";
    /** Opens a tool's card and its form, whose tools then list. */
    const openForm = async (tool: string, ...actions: string[]) => {
      await agentView.call("Inspector.tool", { name: tool });
      await expect.poll(toolNames).toContain(`${card}.openArguments`);
      await agentView.call(`${card}.openArguments`, {
        ref: await agentView.ref(`form "${tool.split(".").at(-1)}"`),
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
    const editorRef = await agentView.ref('form "fill_form"');
    await agentView.call(`FillForm.set`, {
      ref: editorRef,
      args: { name: "Urgent", value: true },
    });
    await expect(await form.control("Urgent").front()).toBeChecked();

    await openForm("generate_locator", `LocatorGroups.toggleFromTree`);
    await openForm("goal", `ValueRows.fill`);
  });

  test("a rooted single instance is preselected and runs from the panel", async ({
    agentView,
    inspector,
  }) => {
    await agentView.call("Inspector.tool", { name: "Navigator.search" });
    const card = inspector.detail.toolPage.card;
    await card.openArguments();
    await expect(await card.items.front()).toHaveCount(1);
    await expect(await card.items.front()).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await card.run({ query: "ListPage.addItem" });
    await expect(await inspector.navigator.searchBox.front()).toHaveValue(
      "ListPage.addItem"
    );
  });

  test("the page state an agent reads includes the panel", async ({
    agentView,
    inspector,
  }) => {
    await expect(await inspector.panel.front()).toBeVisible();
    const { structure } = (await agentView.call("snapshot", {})) as {
      structure: string;
    };
    expect(structure).toContain('complementary "ayme"');
  });

  test("the panel's renderings of the page stay out of the page state", async ({
    agentView,
    inspector,
  }) => {
    const snapshot = async () =>
      ((await agentView.call("snapshot", {})) as { structure: string })
        .structure;

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
  });
});
