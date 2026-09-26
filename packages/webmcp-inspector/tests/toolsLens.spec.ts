import { AgentView } from "./agentView";
import { expect, test } from "./fixtures";

// E2E: the panel shows exactly what an agent gets over WebMCP. The expected
// values come from the page's WebMCP tool list and get_page_context, never
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

test("a Page Object tool's page shows its model's definition as get_page_context returns it", async ({
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
