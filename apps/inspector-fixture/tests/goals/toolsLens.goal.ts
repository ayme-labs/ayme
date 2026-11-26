import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { callOverMcp, placements, testIn } from "../e2e/fixtures";

// The goal-driven twin of ../toolsLens.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the panel shows the page's live tools as the runtime lists them, and a
// Page Object Tool as an agent gets it over ayme MCP, in both placements of
// the Inspector. The expected values come from the page's runtime and the
// agent, never from the panel.

for (const placement of placements) {
  const test = testIn(placement);
  const connected = testIn(placement, "/", { connected: true });
  const unpublished = testIn(placement, "/unpublished.html");

  describe(placement, () => {
    test("the Tools lens lists every live tool of the page", async ({
      agent,
      appView,
      inspector,
    }) => {
      const liveTools = await appView.tools();

      await agent.act("show the {lens} lens", { params: { lens: "Tools" } });

      await expect
        .poll(async () =>
          Object.values(await inspector.navigator.tools.listed())
            .flat()
            .sort()
        )
        .toEqual(liveTools.map(({ name }) => name).sort());
    });

    describe("connected to an agent", () => {
      connected(
        "each tool's page shows the description, schema and destructive mark an agent gets",
        async ({ agent, appView, inspector, mcpServer }) => {
          const liveTools = await appView.tools();
          // The Page Object Tools reach the agent as the runtime lists them.
          const { tools: agentTools } = await mcpServer!.client.listTools();
          const pageObjectTools = liveTools.filter(({ name }) =>
            name.startsWith("ListPage.")
          );
          expect(
            agentTools.filter(({ name }) => name.startsWith("ListPage."))
          ).toEqual(
            pageObjectTools.map(
              ({ name, agentDescription, inputSchema, destructive }) => ({
                name,
                ...(agentDescription && { description: agentDescription }),
                inputSchema,
                ...(destructive && { annotations: { destructiveHint: true } }),
              })
            )
          );
          const { toolPage } = inspector.detail;
          await agent.act("show the {lens} lens", {
            params: { lens: "Tools" },
          });

          for (const tool of liveTools) {
            await agent.act("select {tool} in the Tools lens", {
              params: { tool: tool.name },
            });
            await expect(await toolPage.title.front()).toHaveText(tool.name);
            await agent.act("open What the model sees");

            await expect
              .poll(() => toolPage.descriptionText())
              .toBe(tool.agentDescription ?? "");
            expect(await toolPage.modelSees.schemaValue(tool.name)).toEqual(
              tool.inputSchema
            );
            const destructive = tool.destructive === true;
            expect(await toolPage.destructiveMark.count()).toBe(
              destructive ? 1 : 0
            );
            expect(
              await inspector.navigator.tools.markedDestructive(tool.name)
            ).toBe(destructive);
          }
          // The fixture's ListPage.clear is the one marked.
          expect(
            liveTools
              .filter(({ destructive }) => destructive)
              .map(({ name }) => name)
          ).toEqual(["ListPage.clear"]);
        }
      );

      connected(
        "reading What the model sees leaves the agent's view of the page alone",
        async ({ agent, browser, page, inspector, mcpServer }) => {
          const { modelSees } = inspector.detail.toolPage;
          await agent.act("open the {tool} tool in the Tools lens", {
            params: { tool: "ListPage.addItem" },
          });
          await agent.act("open What the model sees");
          await expect(await modelSees.definitions.front()).toHaveText(
            /^ListPage\b/
          );

          // A toast appears, then the agent's first action changes nothing.
          // Had the panel's read been recorded as a page observation, it
          // would be the agent's "before" and the toast would count as the
          // action's change.
          await page.front();
          await browser.evaluate(() => {
            const toast = document.createElement("p");
            toast.setAttribute("role", "status");
            toast.textContent = "Saved";
            document.body.append(toast);
            return null;
          });
          const result = await callOverMcp(mcpServer!, "ListPage.countItems");

          expect(result).not.toHaveProperty("changes");
        }
      );
    });

    test("a Page Object tool's page shows its model's definition as snapshot returns it", async ({
      agent,
      appView,
      inspector,
    }) => {
      const definition = await appView.pomDefinitions("ListPage");
      const { toolPage } = inspector.detail;

      await agent.act("open the {tool} tool in the Tools lens", {
        params: { tool: "ListPage.addItem" },
      });
      await agent.act("open What the model sees");

      await expect
        .poll(() => toolPage.modelSees.definitionsText())
        .toBe(definition);
    });

    describe("with WebMCP publication off", () => {
      unpublished(
        "the Tools lens still lists the live tools",
        async ({ agent, appView, inspector }) => {
          const liveTools = await appView.tools();

          await agent.act("show the {lens} lens", {
            params: { lens: "Tools" },
          });

          await expect
            .poll(async () =>
              Object.values(await inspector.navigator.tools.listed())
                .flat()
                .sort()
            )
            .toEqual(liveTools.map(({ name }) => name).sort());
        }
      );
    });
  });
}
