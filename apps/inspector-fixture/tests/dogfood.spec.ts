import { executePublishedTool } from "@ayme-dev/ayme/testing";

import { AgentView } from "./agentView";
import { expect, test } from "./fixtures";

// E2E: on the dogfood page the Inspector's own Page Object is a Page Object
// Model like any other: an agent lists its tools, drives the panel through
// them, and sees the panel in the page state.

test.use({ fixturePath: "/dogfood.html" });
// The first load compiles the Inspector's Page Object from source, one
// TypeScript Program per class, which takes the dev server a while.
test.setTimeout(90_000);

test("an agent drives the panel through the Inspector's Page Object Tools", async ({
  page,
  inspector,
}) => {
  const names = (await new AgentView(page).tools()).map(({ name }) => name);
  expect(names).toEqual(
    expect.arrayContaining([
      "ListPage.addItem",
      "Inspector.open",
      "Inspector.navigator.showLens",
      "Inspector.runs.clear",
    ])
  );

  await executePublishedTool(page, "Inspector.navigator.showLens", {
    name: "Tools",
  });

  await expect(inspector.navigator.lens("Tools")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect
    .poll(async () =>
      Object.values(await inspector.navigator.tools.listed()).flat()
    )
    .toContain("Inspector.navigator.showLens");

  // A search in progress does not stop the agent from opening a run card,
  // and the card's own actions come alive with it.
  await executePublishedTool(page, "Inspector.navigator.search", {
    query: "addItem",
  });
  await executePublishedTool(page, "Inspector.tool", {
    name: "ListPage.addItem",
  });
  await expect(inspector.detail.toolPage.title).toHaveText("ListPage.addItem");
  await expect
    .poll(async () =>
      (await new AgentView(page).tools()).map(({ name }) => name)
    )
    .toContain("Inspector.detail.toolPage.card.fillJson");
});

test("the page state an agent reads includes the panel", async ({
  page,
  opened,
}) => {
  void opened;
  const { structure } = (await new AgentView(page).call("snapshot", {})) as {
    structure: string;
  };
  expect(structure).toContain('complementary "ayme"');
});
