import { describe, test as plainTest } from "@e2e-dev/web";
import { expect } from "e2e";

import { panelDescription } from "./e2e/agentView";
import { openFixture, placements, testIn } from "./e2e/fixtures";

// E2E: the panel shows exactly what an agent gets over WebMCP, but for a bare
// action's description, which it shows as Ayme MCP does, in both placements
// of the Inspector. The expected values come from the page's WebMCP tool list
// and snapshot, never from the panel.

// Live, but never published to WebMCP: its result is an image.
const NOT_ON_WEBMCP = ["screenshot"];

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("the Tools lens lists exactly the tools an agent gets", async ({
      agentView,
      inspector,
    }) => {
      const agentTools = await agentView.tools();

      await inspector.navigator.showLens("Tools");

      await expect
        .poll(async () =>
          Object.values(await inspector.navigator.tools.listed())
            .flat()
            .sort()
        )
        .toEqual(
          [...agentTools.map(({ name }) => name), ...NOT_ON_WEBMCP].sort()
        );
    });

    test("each tool's page shows the description, schema and destructive mark an agent gets", async ({
      agentView,
      inspector,
    }) => {
      const agentTools = await agentView.tools();
      const { toolPage } = inspector.detail;
      await inspector.navigator.showLens("Tools");

      for (const tool of agentTools) {
        await inspector.navigator.tools.tool(tool.name).click();
        await expect(await toolPage.title.front()).toHaveText(tool.name);
        await toolPage.modelSees.open();

        await expect
          .poll(() => toolPage.descriptionText())
          .toBe(panelDescription(tool));
        expect(await toolPage.modelSees.schemaValue(tool.name)).toEqual(
          tool.inputSchema
        );
        const destructive = tool.annotations?.consequentialHint === true;
        expect(await toolPage.destructiveMark.count()).toBe(
          destructive ? 1 : 0
        );
        expect(
          await inspector.navigator.tools.markedDestructive(tool.name)
        ).toBe(destructive);
      }
      // The fixture's ListPage.clear is the one marked.
      expect(
        agentTools
          .filter(({ annotations }) => annotations?.consequentialHint)
          .map(({ name }) => name)
      ).toEqual(["ListPage.clear"]);
    });

    test("a Page Object tool's page shows its model's definition as snapshot returns it", async ({
      agentView,
      inspector,
    }) => {
      const definition = await agentView.pomDefinitions("ListPage");
      const { toolPage } = inspector.detail;

      await inspector.tool("ListPage.addItem");
      await toolPage.modelSees.open();

      await expect
        .poll(() => toolPage.modelSees.definitionsText())
        .toBe(definition);
    });

    test("reading What the model sees leaves the agent's view of the page alone", async ({
      agentView,
      browser,
      page,
      inspector,
    }) => {
      const { modelSees } = inspector.detail.toolPage;
      await inspector.tool("ListPage.addItem");
      await modelSees.open();
      await expect(await modelSees.definitions.front()).toHaveText(
        /^ListPage\b/
      );

      // A toast appears, then the agent's first action changes nothing. Had
      // the panel's read been recorded as a page observation, it would be the
      // agent's "before" and the toast would count as the action's change.
      await page.front();
      await browser.evaluate(() => {
        const toast = document.createElement("p");
        toast.setAttribute("role", "status");
        toast.textContent = "Saved";
        document.body.append(toast);
        return null;
      });
      const result = await agentView.call("ListPage.countItems", {});

      expect(result).toMatchObject({ page_changed: false });
    });
  });
}

// Inline only: it opens fixture pages of its own, as the Playwright version,
// whose external project ran it inline too.
plainTest(
  "with publication off, the Tools lens still lists the live tools",
  async (fixtures) => {
    // The same list app with publication on: every live tool but screenshot is
    // published, so its WebMCP tool list and screenshot are the live set.
    const published = await openFixture(fixtures, "/");
    const liveTools = (await published.agentView.tools()).map(
      ({ name }) => name
    );

    const { inspector } = await openFixture(fixtures, "/unpublished.html");
    await inspector.navigator.showLens("Tools");

    await expect
      .poll(async () =>
        Object.values(await inspector.navigator.tools.listed())
          .flat()
          .sort()
      )
      .toEqual([...liveTools, ...NOT_ON_WEBMCP].sort());
  }
);
