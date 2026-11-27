import { AppView } from "./appView";
import { callAsAgent, expect, test } from "./fixtures";

// E2E: the panel shows the page's live tools as the runtime lists them, and a
// Page Object Tool as an agent gets it through WebMCP. The expected values
// come from the page's runtime and the agent, never from the panel.

test("the Tools lens lists every live tool of the page", async ({
  page,
  inspector,
}) => {
  const liveTools = await new AppView(page).tools();

  await inspector.navigator.showLens("Tools");

  await expect
    .poll(async () =>
      Object.values(await inspector.navigator.tools.listed())
        .flat()
        .sort()
    )
    .toEqual(liveTools.map(({ name }) => name).sort());
});

test.describe("connected to an agent", () => {
  test.use({ connected: true });

  test("each tool's page shows the description, schema and destructive mark an agent gets", async ({
    page,
    inspector,
    agent,
  }) => {
    const liveTools = await new AppView(page).tools();
    // The Page Object Tools reach the agent as the runtime lists them; WebMCP
    // needs a description, so a tool without one is named by its action.
    const pageObjectTools = liveTools.filter(({ name }) =>
      name.startsWith("ListPage.")
    );
    for (const {
      name,
      agentDescription,
      inputSchema,
      destructive,
    } of pageObjectTools)
      expect(await agent!.tool(name)).toEqual({
        name,
        description: agentDescription ?? `Run ${name.split(".").at(-1)}.`,
        inputSchema,
        ...(destructive && { annotations: { consequentialHint: true } }),
      });
    const { toolPage } = inspector.detail;
    await inspector.navigator.showLens("Tools");

    for (const tool of liveTools) {
      await inspector.navigator.tools.tool(tool.name).click();
      await expect(toolPage.title).toHaveText(tool.name);
      await toolPage.modelSees.open();

      await expect
        .poll(() => toolPage.descriptionText())
        .toBe(tool.agentDescription ?? "");
      expect(await toolPage.modelSees.schemaValue(tool.name)).toEqual(
        tool.inputSchema
      );
      const destructive = tool.destructive === true;
      expect(await toolPage.destructiveMark.count()).toBe(destructive ? 1 : 0);
      expect(await inspector.navigator.tools.markedDestructive(tool.name)).toBe(
        destructive
      );
    }
    // The fixture's ListPage.clear is the one marked.
    expect(
      liveTools.filter(({ destructive }) => destructive).map(({ name }) => name)
    ).toEqual(["ListPage.clear"]);
  });

  test("reading What the model sees leaves the agent's view of the page alone", async ({
    page,
    inspector,
    agent,
  }) => {
    const { modelSees } = inspector.detail.toolPage;
    await inspector.tool("ListPage.addItem");
    await modelSees.open();
    await expect(modelSees.definitions).toHaveText(/^ListPage\b/);

    // A toast appears, then the agent's first action changes nothing. Had
    // the panel's read been recorded as a page observation, it would be the
    // agent's "before" and the toast would count as the action's change.
    await page.evaluate(() => {
      const toast = document.createElement("p");
      toast.setAttribute("role", "status");
      toast.textContent = "Saved";
      document.body.append(toast);
    });
    const result = await callAsAgent(agent!, "ListPage.countItems");

    expect(result).not.toHaveProperty("changes");
  });
});

test("a Page Object tool's page shows its model's definition as snapshot returns it", async ({
  page,
  inspector,
}) => {
  const definition = await new AppView(page).pomDefinitions("ListPage");
  const { toolPage } = inspector.detail;

  await inspector.tool("ListPage.addItem");
  await toolPage.modelSees.open();

  await expect
    .poll(() => toolPage.modelSees.definitions.textContent())
    .toBe(definition);
});

test.describe("with WebMCP publication off", () => {
  test.use({ fixturePath: "/unpublished.html" });

  test("the Tools lens still lists the live tools", async ({
    page,
    inspector,
  }) => {
    const liveTools = await new AppView(page).tools();

    await inspector.navigator.showLens("Tools");

    await expect
      .poll(async () =>
        Object.values(await inspector.navigator.tools.listed())
          .flat()
          .sort()
      )
      .toEqual(liveTools.map(({ name }) => name).sort());
  });
});
