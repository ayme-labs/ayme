import { AgentView } from "./agentView";
import { expect, openFixture, test } from "./fixtures";

// E2E: the panel shows exactly what an agent gets over WebMCP. The expected
// values come from the page's WebMCP tool list and snapshot, never
// from the panel.

test("the Tools lens lists exactly the tools an agent gets", async ({
  page,
  inspector,
}) => {
  const agentTools = await new AgentView(page).tools();

  await inspector.navigator.showLens("Tools");

  await expect
    .poll(async () =>
      Object.values(await inspector.navigator.tools.listed())
        .flat()
        .sort()
    )
    .toEqual(agentTools.map(({ name }) => name).sort());
});

test("each tool's page shows the description and schema an agent gets", async ({
  page,
  inspector,
}) => {
  const agentTools = await new AgentView(page).tools();
  const { toolPage } = inspector.detail;
  await inspector.navigator.showLens("Tools");

  for (const tool of agentTools) {
    await inspector.navigator.tools.tool(tool.name).click();
    await expect(toolPage.title).toHaveText(tool.name);
    await toolPage.modelSees.open();

    await expect(toolPage.description).toHaveText(tool.description);
    expect(await toolPage.modelSees.schemaValue(tool.name)).toEqual(
      tool.inputSchema
    );
  }
});

test("a Page Object tool's page shows its model's definition as snapshot returns it", async ({
  page,
  inspector,
}) => {
  const definition = await new AgentView(page).pomDefinitions("ListPage");
  const { toolPage } = inspector.detail;

  await inspector.tool("ListPage.addItem");
  await toolPage.modelSees.open();

  await expect
    .poll(() => toolPage.modelSees.definitions.textContent())
    .toBe(definition);
});

test("reading What the model sees leaves the agent's view of the page alone", async ({
  page,
  inspector,
}) => {
  const { modelSees } = inspector.detail.toolPage;
  await inspector.tool("ListPage.addItem");
  await modelSees.open();
  await expect(modelSees.definitions).toContainText("POM ListPage");

  // A toast appears, then the agent's first action changes nothing. Had the
  // panel's read been recorded as a page observation, it would be the
  // agent's "before" and the toast would count as the action's change.
  await page.evaluate(() => {
    const toast = document.createElement("p");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.append(toast);
  });
  const result = await new AgentView(page).call("ListPage.countItems", {});

  expect(result).toMatchObject({ page_changed: false });
});

test("with publication off, the Tools lens still lists the live tools", async ({
  page,
}) => {
  // The same list app with publication on: every live tool is published, so
  // its WebMCP tool list is the live set.
  await openFixture(page, "/");
  const liveTools = (await new AgentView(page).tools()).map(({ name }) => name);

  const { inspector } = await openFixture(page, "/unpublished.html");
  await inspector.navigator.showLens("Tools");

  await expect
    .poll(async () =>
      Object.values(await inspector.navigator.tools.listed())
        .flat()
        .sort()
    )
    .toEqual(liveTools.sort());
});
