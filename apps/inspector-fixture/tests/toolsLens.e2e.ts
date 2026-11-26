import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { callOverMcp, INSPECTOR, placements, testIn } from "./e2e/fixtures";
import { panelLook } from "./e2e/pom/Inspector";

// E2E: the panel shows the page's live tools as the runtime lists them, and a
// Page Object Tool as an agent gets it over ayme MCP, in both placements of
// the Inspector. The expected values come from the page's runtime and the
// agent, never from the panel.

for (const placement of placements) {
  const test = testIn(placement);
  const connected = testIn(placement, "/", { connected: true });
  const unpublished = testIn(placement, "/unpublished.html");
  // The session's inspector option turns the page's Peeks on; the other
  // fixture pages mount the panel themselves.
  const withInspectorOption = testIn(placement, "/session.html");

  describe(placement, () => {
    test("the Tools lens lists every live tool of the page", async ({
      appView,
      inspector,
    }) => {
      const liveTools = await appView.tools();

      await inspector.navigator.showLens("Tools");
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.navigator.tools.tool(liveTools[0]!.name).front()
      ).waitFor();

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
        async ({ appView, inspector, mcpServer }) => {
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
          await inspector.navigator.showLens("Tools");

          for (const tool of liveTools) {
            await inspector.navigator.tools.tool(tool.name).click();
            await expect(await toolPage.title.front()).toHaveText(tool.name);
            // The section stays open from one tool to the next: the page keeps
            // its state when the tool changes.
            if (tool === liveTools[0]) await toolPage.modelSees.open();
            // Counted by e2e's replay cache, so the goal twin's goals are saved.
            await (await toolPage.title.front()).waitFor();

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
        async ({ browser, page, inspector, mcpServer }) => {
          const { modelSees } = inspector.detail.toolPage;
          await inspector.tool("ListPage.addItem");
          await modelSees.open();
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
      appView,
      inspector,
    }) => {
      const definition = await appView.pomDefinitions("ListPage");
      const { toolPage } = inspector.detail;

      await inspector.tool("ListPage.addItem");
      await toolPage.modelSees.open();
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (await toolPage.modelSees.definitions.front()).waitFor();

      await expect
        .poll(() => toolPage.modelSees.definitionsText())
        .toBe(definition);
    });

    describe("with WebMCP publication off", () => {
      unpublished(
        "the Tools lens still lists the live tools",
        async ({ appView, inspector }) => {
          const liveTools = await appView.tools();

          await inspector.navigator.showLens("Tools");
          // Counted by e2e's replay cache, so the goal twin's goals are saved.
          await (
            await inspector.navigator.tools.tool(liveTools[0]!.name).front()
          ).waitFor();

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

    test("a tool that can't run now shows dimmed with its reason, and Run gives the refusal", async ({
      appView,
      inspector,
    }) => {
      const clear = (await appView.tools()).find(
        ({ name }) => name === "ListPage.clear"
      )!;
      // The fixture's list starts empty, so its ListPage.clear has nothing to
      // clear.
      expect(clear.available).toBe(false);
      // Asked before the panel runs it: the app's own run is a Run too.
      const refusal = await appView.refusal("ListPage.clear");

      const card = await inspector.tool("ListPage.clear");

      // The tool's run card is dimmed and gives the reason; its row in the
      // Tools lens's list shows neither. e2e has no CSS matcher: the card's
      // computed opacity, read in the panel. The card is the Selected
      // region's only form, as `runCard()` finds it.
      await expect
        .poll(
          async () =>
            (
              await panelLook(
                inspector.tab,
                'section[aria-label="Selected"] form',
                ["opacity"]
              )
            )?.opacity
        )
        .toBe("0.6");
      await expect(await card.reason.front()).toHaveText(clear.reason!);
      await expect(await card.runButton.front()).toBeEnabled();
      await card.runButton.click();
      // Counted by e2e's replay cache, so the goal twin's goals are saved.
      await (
        await inspector.runs.runs.within((runs) => runs.first()).front()
      ).waitFor();
      // The newest run of the tool is the app's until the panel's arrives.
      const run = inspector.runs.latest("ListPage.clear");
      await expect.poll(() => run.caller()).toEqual(INSPECTOR);
      await expect.poll(() => run.status()).toBe("Failed");
      await expect.poll(async () => (await run.read())?.error).toBe(refusal);
    });

    describe("with the inspector option on", () => {
      withInspectorOption(
        "the page's own Peek lists under Peek tools, and its tool page reads it",
        async ({ appView, inspector, listPage }) => {
          const peeks = (await appView.tools())
            .filter(({ group }) => group === "peek")
            .map(({ name }) => name);
          // The fixture's Peek of its list.
          expect(peeks).toEqual(["peek.list"]);
          await listPage.addItem("Milk");

          await inspector.navigator.showLens("Tools");
          await expect
            .poll(() => inspector.navigator.tools.peekSections())
            .toEqual({ Browser: peeks });
          await (await inspector.tool("peek.list")).runButton.click();
          // Counted by e2e's replay cache, so the goal twin's goals are saved.
          await (
            await inspector.runs.runs.within((runs) => runs.first()).front()
          ).waitFor();

          const run = inspector.runs.latest("peek.list");
          await expect.poll(() => run.status()).toBe("Succeeded");
          expect(JSON.parse((await run.resultText()) ?? "")).toEqual(
            await appView.run("peek.list")
          );
        }
      );
    });
  });
}
