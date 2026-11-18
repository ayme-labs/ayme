import { describe } from "@e2e-dev/web";
import { expect } from "e2e";

import { panelDescription } from "./e2e/agentView";
import { INSPECTOR, placements, testIn } from "./e2e/fixtures";

// E2E: the lenses, the run card, Runs and What the model sees working
// together on the fixture page, with the real runtime, in both placements of
// the Inspector. Expected values come from the page and from what an agent
// gets over WebMCP, never from the panel.

for (const placement of placements) {
  const test = testIn(placement);

  describe(placement, () => {
    test("a structure node's Browser tool runs on that node, and Runs shows the run as yours", async ({
      inspector,
      listPage,
    }) => {
      await inspector.navigator.showLens("Structure");
      await inspector.structure.nodeOf("ListPage.newItemInput").click();
      const fill = inspector.detail.node.runCard("fill");

      await fill.run({ text: "Bread" });

      await expect(await listPage.newItemInput.front()).toHaveValue("Bread");
      const run = inspector.runs.latest("fill");
      await expect.poll(() => run.status()).toBe("Succeeded");
      expect(await run.caller()).toEqual(INSPECTOR);
    });

    test("a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives an agent", async ({
      agentView,
      inspector,
      listPage,
    }) => {
      const addItem = (await agentView.tools()).find(
        ({ name }) => name === "ListPage.addItem"
      )!;
      const definition = await agentView.pomDefinitions("ListPage");
      const { toolPage } = inspector.detail;

      const card = await inspector.tool("ListPage.addItem");

      await expect
        .poll(() => toolPage.descriptionText())
        .toBe(panelDescription(addItem));
      await expect(await card.argumentsToggle.front()).toHaveCount(0);
      await card.run({ text: "Bread" });
      await expect(
        await listPage.items
          .within((items) => items.filter({ hasText: "Bread" }))
          .front()
      ).toHaveCount(1);
      await toolPage.modelSees.open();
      await expect
        .poll(() => toolPage.modelSees.definitionsText())
        .toBe(definition);
    });

    test("a checked checkbox reads as checked in its node's What the model sees, as in the page state an agent gets", async ({
      agentView,
      inspector,
      listPage,
    }) => {
      await inspector.navigator.showLens("Structure");
      await inspector.structure.nodeNamed("checkbox", "Urgent").click();
      const { modelSees } = inspector.detail.node;
      await modelSees.open();

      await listPage.urgentCheckbox.check();

      await expect(await modelSees.pageState.front()).toContainText(
        "[checked]"
      );
      const { structure } = (await agentView.call("snapshot", {})) as {
        structure: string;
      };
      const agentLines = structure.split("\n").map((line) => line.trim());
      const [nodeLine] = (await modelSees.pageStateText())!.split("\n");
      expect(agentLines).toContain(nodeLine);
    });
  });
}
